/**
 * WebMCP, as the browser exposes it.
 *
 * The proposed standard puts this on `document.modelContext`; Chromium carried
 * it on `navigator.modelContext` until 150 and some hosts may still. Declaring
 * both here means the call sites can be the plain spec calls rather than casts,
 * which is worth it for a surface this central.
 *
 * Spec: https://github.com/webmachinelearning/webmcp
 */

interface WebMCPToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: unknown;
}

interface WebMCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: Record<string, never>) => Promise<WebMCPToolResult>;
}

interface WebMCPRegisterOptions {
  /** Aborting withdraws the tools registered with it. */
  signal?: AbortSignal;
  exposedTo?: string[];
}

interface ModelContext {
  registerTool(tool: WebMCPToolDescriptor, options?: WebMCPRegisterOptions): Promise<void> | void;
  /** Absent in Chrome 152; withdrawal goes through the AbortSignal instead. */
  unregisterTool?(name: string): Promise<void> | void;
  getTools?(): Promise<WebMCPToolDescriptor[]>;
  executeTool?(tool: WebMCPToolDescriptor, args: string): Promise<WebMCPToolResult>;
}

interface Document {
  readonly modelContext?: ModelContext;
}

interface Navigator {
  readonly modelContext?: ModelContext;
}
