// ── Shared HTTP client base ───────────────────────────────────────────────
//
// Every existing api/ client (aesClient, ovaRankings, timuClient,
// sidelineHdApi) hand-rolled its own fetch wrapper. They all do the
// same things slightly differently:
//   • Append a cache-buster
//   • Set no-cache headers
//   • Throw on !response.ok with a source-prefixed message
//   • Decide what to do with empty bodies / HTML-when-JSON-expected
//
// This module concentrates those concerns. `ApiError` is the one error
// shape callers `catch` on; `fetchJson` and `fetchText` are the two
// entry points. Existing clients adopt incrementally — there's no
// pressure to migrate every endpoint at once.
//
// What's intentionally NOT here:
//   • Auth header injection — each source's auth (MRS cookies,
//     SidelineHD tokens) is too varied to belong in a base. Clients
//     pass headers through via `opts.headers`.
//   • Response caching — `apiCache` already owns that, lives one
//     layer up.
//   • Body shape validation — caller decides (parse JSON, return text,
//     run cheerio, etc.). Base only reads + handles transport.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The one error every base-level HTTP failure throws. Callers can
 * narrow on `error instanceof ApiError` to extract structured fields
 * without parsing message strings. `source` identifies which subsystem
 * threw — useful for telemetry tagging at the catch site.
 */
export class ApiError extends Error {
  readonly source: string;
  /** HTTP status when known. -1 for network-level errors (no response). */
  readonly status: number;
  /** Short machine code: 'http', 'network', 'parse', 'empty-body', 'html-when-json'. */
  readonly code: ApiErrorCode;
  /**
   * Hint to retry middleware — true when the failure was likely
   * transient (network, 5xx, 429). 4xx and parse errors are NOT
   * retriable. Callers SHOULD respect this flag rather than retry
   * blindly.
   */
  readonly retriable: boolean;

  constructor(args: {
    source: string;
    status: number;
    code: ApiErrorCode;
    retriable: boolean;
    message: string;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.source = args.source;
    this.status = args.status;
    this.code = args.code;
    this.retriable = args.retriable;
  }
}

export type ApiErrorCode =
  | 'http'
  | 'network'
  | 'parse'
  | 'empty-body'
  | 'html-when-json';

export interface FetchOptions {
  /**
   * Source tag for error attribution + log messages. e.g. 'aes',
   * 'ova-rankings'. Required so failures are immediately attributable.
   */
  source: string;
  /** Extra request headers. Merged with the no-cache defaults. */
  headers?: Record<string, string>;
  /**
   * Append `_t=<ms>` to bust caches. Default true — most APIs we hit
   * have live data behind them. Set false for endpoints that return
   * truly static content.
   */
  cacheBust?: boolean;
  /**
   * Retry count on retriable errors (network + 5xx + 429). Default 0
   * — opt-in per call. Backoff is fixed at 200ms * 2^attempt; callers
   * that need fancier policies should wrap.
   */
  retries?: number;
  /**
   * Custom timeout in ms. Default undefined (uses platform default).
   * Implemented via AbortController so it works under React Native +
   * Node test environments.
   */
  timeoutMs?: number;
}

/**
 * Append a cache-busting `_t=<ms>` to the URL. Idempotent — calling
 * twice produces two cache busters, but that's harmless.
 */
function withCacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_t=${Date.now()}`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  controller: AbortController
): Promise<T> {
  if (timeoutMs == null) return promise;
  let handle: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      controller.abort();
      reject(
        new ApiError({
          source: 'timeout',
          status: -1,
          code: 'network',
          retriable: true,
          message: `Request timed out after ${timeoutMs}ms`,
        })
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (handle != null) clearTimeout(handle);
  }
}

/**
 * Low-level fetch wrapper that applies cache-busting, default headers,
 * timeout, and retry policy. Returns a `Response` — callers project
 * to JSON / text. Used internally by `fetchJson` + `fetchText`.
 */
async function rawFetch(
  url: string,
  opts: FetchOptions,
  extraHeaders: Record<string, string>
): Promise<Response> {
  const retries = Math.max(0, opts.retries ?? 0);
  const cacheBust = opts.cacheBust !== false;
  const target = cacheBust ? withCacheBust(url) : url;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    try {
      const res = await withTimeout(
        fetch(target, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            ...extraHeaders,
            ...(opts.headers ?? {}),
          },
          cache: 'no-store' as RequestCache,
          signal: controller.signal,
        }),
        opts.timeoutMs,
        controller
      );
      if (!res.ok) {
        const retriable = res.status === 429 || res.status >= 500;
        const error = new ApiError({
          source: opts.source,
          status: res.status,
          code: 'http',
          retriable,
          message: `${opts.source} HTTP ${res.status} ${res.statusText}`,
        });
        if (retriable && attempt < retries) {
          lastError = error;
          await backoffDelay(attempt);
          continue;
        }
        throw error;
      }
      return res;
    } catch (err) {
      // ApiError thrown above for non-OK status — preserve.
      if (err instanceof ApiError) {
        if (err.retriable && attempt < retries) {
          lastError = err;
          await backoffDelay(attempt);
          continue;
        }
        throw err;
      }
      // Other throws — typically a network failure or abort. Wrap in
      // ApiError so callers have one shape to handle.
      const wrapped = new ApiError({
        source: opts.source,
        status: -1,
        code: 'network',
        retriable: true,
        message: `${opts.source} network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      if (attempt < retries) {
        lastError = wrapped;
        await backoffDelay(attempt);
        continue;
      }
      throw wrapped;
    }
  }
  // Loop only exits via throw or return; this is unreachable.
  throw lastError ?? new Error('rawFetch exhausted retries with no error');
}

/** 200ms, 400ms, 800ms… capped at 2s. */
function backoffDelay(attempt: number): Promise<void> {
  const ms = Math.min(2000, 200 * Math.pow(2, attempt));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch + parse JSON. Throws `ApiError` for transport, parse,
 * empty-body, or HTML-returned-instead-of-JSON failures. Caller picks
 * the response type via the generic.
 */
export async function fetchJson<T>(
  url: string,
  opts: FetchOptions
): Promise<T> {
  const res = await rawFetch(url, opts, {
    Accept: 'application/json',
  });
  const text = await res.text();
  if (!text || text.trim().length === 0) {
    throw new ApiError({
      source: opts.source,
      status: res.status,
      code: 'empty-body',
      retriable: false,
      message: `${opts.source} returned an empty body`,
    });
  }
  if (text.startsWith('<')) {
    throw new ApiError({
      source: opts.source,
      status: res.status,
      code: 'html-when-json',
      retriable: false,
      message: `${opts.source} returned HTML where JSON was expected`,
    });
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ApiError({
      source: opts.source,
      status: res.status,
      code: 'parse',
      retriable: false,
      message: `${opts.source} JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

/**
 * Fetch + return body text (HTML, plaintext, anything non-JSON).
 * Empty bodies are allowed — callers that need at least some content
 * should check the return value.
 */
export async function fetchText(
  url: string,
  opts: FetchOptions
): Promise<string> {
  const res = await rawFetch(url, opts, {
    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
  });
  return res.text();
}
