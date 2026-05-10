// ── LoaderResult<T> ───────────────────────────────────────────────────────
//
// Shared tagged-union return type for screen-level loaders that need to
// distinguish "got nothing back" (empty success) from "the request blew
// up" (network / parse error). The previous pattern — try/catch into a
// silently-empty array — left the UI unable to differentiate "no
// tournaments yet" from "we couldn't reach the API", so users hit a
// blank state instead of a retry affordance.
//
// Consumers pattern-match on `status`:
//   - 'ok'    → render `data`
//   - 'empty' → render the empty state
//   - 'error' → render an error surface with a retry handler
// ────────────────────────────────────────────────────────────────────────────

export type LoaderResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  if (typeof err === 'string' && err.length > 0) return err;
  return fallback;
}
