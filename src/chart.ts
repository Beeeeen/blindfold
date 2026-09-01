import * as Plot from '@observablehq/plot';

/**
 * The one-way mirror.
 *
 * The agent hands over aggregated rows and a shape to draw. The chart appears
 * on the human's screen. What the agent gets back is the word "drawn". This is
 * the part of the design that only works because the tool runs inside the page:
 * a server-side agent cannot show a person something without first holding it.
 */

export interface ChartSpec {
  title?: string;
  kind: 'bar' | 'line' | 'area' | 'dot' | 'histogram';
  x: string;
  y: string;
  series?: string;
  rows: Record<string, unknown>[];
  caption?: string;
  x_label?: string;
  y_label?: string;
}

let container: HTMLElement | null = null;

export function mountCharts(el: HTMLElement): void {
  container = el;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function renderChart(spec: ChartSpec): number {
  if (!container) throw new Error('chart surface is not mounted');

  const data = (spec.rows ?? [])
    .map((row) => ({
      ...row,
      __x: spec.kind === 'bar' ? String(row[spec.x] ?? '') : (toNumber(row[spec.x]) ?? String(row[spec.x] ?? '')),
      __y: toNumber(row[spec.y]),
      __s: spec.series ? String(row[spec.series] ?? '') : undefined,
    }))
    .filter((d) => d.__y !== null);

  if (!data.length) throw new Error('none of the supplied rows had a plottable value');

  const marks: Plot.Markish[] = [];

  switch (spec.kind) {
    case 'line':
      marks.push(Plot.line(data, { x: '__x', y: '__y', stroke: spec.series ? '__s' : '#2f6f4f', strokeWidth: 2 }));
      marks.push(Plot.dot(data, { x: '__x', y: '__y', fill: spec.series ? '__s' : '#2f6f4f', r: 3 }));
      break;
    case 'area':
      marks.push(Plot.areaY(data, { x: '__x', y: '__y', fill: spec.series ? '__s' : '#2f6f4f', fillOpacity: 0.5 }));
      break;
    case 'dot':
      marks.push(Plot.dot(data, { x: '__x', y: '__y', fill: spec.series ? '__s' : '#2f6f4f', r: 4 }));
      break;
    case 'histogram': {
      // The rows arrive pre-binned from the distribution tool, so the bar width
      // is the gap between consecutive bin starts rather than something Plot
      // should re-derive.
      const xs = [...new Set(data.map((d) => Number(d.__x)))].sort((a, b) => a - b);
      const step = xs.length > 1 ? xs[1] - xs[0] : 1;
      marks.push(
        Plot.rectY(data, {
          x1: '__x',
          x2: (d: { __x: number }) => Number(d.__x) + step,
          y: '__y',
          fill: spec.series ? '__s' : '#2f6f4f',
          fillOpacity: spec.series ? 0.7 : 1,
        }),
      );
      break;
    }
    case 'bar':
    default:
      marks.push(Plot.barY(data, { x: '__x', y: '__y', fill: spec.series ? '__s' : '#2f6f4f' }));
      break;
  }
  marks.push(Plot.ruleY([0], { stroke: '#c9cfc9' }));

  // Keep the order the caller supplied. The aggregate tools already sort, and a
  // level or month axis is ruined by re-sorting it on magnitude.
  const isOrdinal = spec.kind === 'bar';
  const domain = isOrdinal ? [...new Set(data.map((d) => String(d.__x)))] : undefined;

  const figure = Plot.plot({
    marks,
    width: Math.min(container.clientWidth || 720, 900),
    height: 320,
    marginLeft: 64,
    marginBottom: 56,
    x: { label: spec.x_label ?? spec.x, tickRotate: spec.kind === 'bar' ? -25 : 0, domain },
    y: { label: spec.y_label ?? spec.y, grid: true },
    color: spec.series ? { legend: true, scheme: 'Tableau10' } : undefined,
    style: { background: 'transparent', fontFamily: 'inherit', fontSize: '12px' },
  });

  const card = document.createElement('figure');
  card.className = 'chart-card';
  const heading = document.createElement('figcaption');
  heading.className = 'chart-title';
  heading.textContent = spec.title ?? `${spec.y} by ${spec.x}`;
  card.append(heading, figure);
  if (spec.caption) {
    const note = document.createElement('p');
    note.className = 'chart-caption';
    note.textContent = spec.caption;
    card.append(note);
  }

  const empty = container.querySelector('.chart-empty');
  if (empty) empty.remove();
  container.prepend(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  return data.length;
}

export function clearCharts(): void {
  if (container) container.innerHTML = '';
}
