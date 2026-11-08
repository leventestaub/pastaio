/**
 * Dev logger: structured terminal output for app-side activity.
 *
 * Mirrors app/services/dev_log.py on the backend. When you watch the
 * Expo Metro terminal, you see what the user typed, what tool was
 * dispatched, and what the result was. When you watch the uvicorn
 * terminal, you see what the LLM was asked and what it returned.
 *
 * No correlation IDs across the two — keeping this simple. The
 * timestamps line up well enough when you're watching both terminals
 * side by side, and most debugging happens within one process anyway.
 *
 * Toggle via globalThis.__PASTAIO_DEV_LOG__ if you ever want to silence
 * it (no env vars in RN runtime). Default on in dev, off in prod.
 */

const ENABLED = __DEV__;

function ts(): string {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0') +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function trunc(value: unknown, max = 400): string {
  const s =
    typeof value === 'string' ? value : JSON.stringify(value, null, 0);
  if (s.length <= max) return s;
  return s.slice(0, max) + `...(${s.length - max} more chars)`;
}

// React Native's Metro logger doesn't render ANSI cleanly. Use plain
// labels with brackets — they're greppable and obvious in scrollback.
function out(prefix: string, message: string): void {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.log(`${ts()} ${prefix} ${message}`);
}

export function logRequestStart(label: string): void {
  out('────────', '');
  out('[app ▶]', label);
}

export function logUserInput(message: string, context?: unknown): void {
  out('[user →]', trunc(message, 600));
  if (context !== undefined) {
    out('         ', `context: ${trunc(context, 400)}`);
  }
}

export function logBackendCall(
  endpoint: string,
  payloadSummary: string
): void {
  out('[bk ←]', `${endpoint} :: ${payloadSummary}`);
}

export function logBackendResponse(
  endpoint: string,
  summary: string,
  latencyMs: number
): void {
  out('[bk →]', `${endpoint} (${latencyMs}ms) :: ${summary}`);
}

export function logToolDispatch(
  toolName: string,
  args: unknown
): void {
  out('[tool ←]', `${toolName}(${trunc(args, 200)})`);
}

export function logToolResult(
  toolName: string,
  result: unknown,
  summary: string
): void {
  out('[tool →]', `${toolName} :: ${summary}`);
  if (result !== null && result !== undefined) {
    out('          ', `data: ${trunc(result, 300)}`);
  }
}

export function logError(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  out('[✗ err]', `${where}: ${msg}`);
}

export function logDone(summary: string): void {
  out('[app ◀]', summary);
}