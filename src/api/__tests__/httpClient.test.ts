// Tests for the shared httpClient base. fetch is mocked at the global
// level so we can exercise transport branches without a real network.
// Coverage:
//   • fetchJson on a healthy 200 — returns parsed JSON
//   • fetchJson on empty body — ApiError code 'empty-body'
//   • fetchJson on HTML body — ApiError code 'html-when-json'
//   • fetchJson on parse failure — ApiError code 'parse'
//   • fetchText on a healthy 200 — returns body string
//   • 4xx → ApiError with retriable=false
//   • 5xx → ApiError with retriable=true
//   • retries on 5xx the configured number of times then surfaces error
//   • network error → ApiError code 'network', retriable=true
//   • cache-busting toggle and source tag in error messages
//   • header merge respects caller-supplied Authorization

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { ApiError, fetchJson, fetchText } from '../httpClient';

// Cast fetch to a vi mock once at top so handlers can `mockResolvedValueOnce`
// without TypeScript complaints.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  vi.useRealTimers();
});

function ok(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Custom',
    text: async () => body,
  } as Response;
}

function bad(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    statusText: `Status ${status}`,
    text: async () => body,
  } as Response;
}

describe('fetchJson', () => {
  it('returns parsed JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(ok(JSON.stringify({ a: 1 })));
    const out = await fetchJson<{ a: number }>('https://x/y', { source: 'x' });
    expect(out.a).toBe(1);
  });

  it('appends a cache-buster by default', async () => {
    fetchMock.mockResolvedValueOnce(ok('{}'));
    await fetchJson('https://x/y', { source: 'x' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toMatch(/_t=\d+/);
  });

  it('skips the cache-buster when cacheBust=false', async () => {
    fetchMock.mockResolvedValueOnce(ok('{}'));
    await fetchJson('https://x/y', { source: 'x', cacheBust: false });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://x/y');
  });

  it('throws ApiError with code "empty-body" when body is blank', async () => {
    fetchMock.mockResolvedValueOnce(ok('   '));
    await expect(fetchJson('https://x/y', { source: 'x' })).rejects.toMatchObject({
      code: 'empty-body',
      retriable: false,
    });
  });

  it('throws ApiError with code "html-when-json" when body starts with <', async () => {
    fetchMock.mockResolvedValueOnce(ok('<!doctype html><html></html>'));
    await expect(fetchJson('https://x/y', { source: 'x' })).rejects.toMatchObject({
      code: 'html-when-json',
    });
  });

  it('throws ApiError with code "parse" on malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(ok('not valid json {'));
    await expect(fetchJson('https://x/y', { source: 'x' })).rejects.toMatchObject({
      code: 'parse',
    });
  });

  it('throws ApiError with retriable=false on 404', async () => {
    fetchMock.mockResolvedValueOnce(bad(404));
    const err = await fetchJson('https://x/y', { source: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).retriable).toBe(false);
  });

  it('throws ApiError with retriable=true on 500', async () => {
    fetchMock.mockResolvedValueOnce(bad(500));
    const err = await fetchJson('https://x/y', { source: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).retriable).toBe(true);
  });

  it('retries on 5xx up to the configured count and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(bad(500))
      .mockResolvedValueOnce(bad(503))
      .mockResolvedValueOnce(ok('{"a":1}'));
    const out = await fetchJson<{ a: number }>('https://x/y', {
      source: 'x',
      retries: 2,
    });
    expect(out.a).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the error when retries are exhausted', async () => {
    fetchMock
      .mockResolvedValueOnce(bad(500))
      .mockResolvedValueOnce(bad(500))
      .mockResolvedValueOnce(bad(500));
    await expect(
      fetchJson('https://x/y', { source: 'x', retries: 2 })
    ).rejects.toMatchObject({ status: 500, retriable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a 404', async () => {
    fetchMock.mockResolvedValueOnce(bad(404));
    await expect(
      fetchJson('https://x/y', { source: 'x', retries: 5 })
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps network errors in ApiError code "network"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const err = await fetchJson('https://x/y', { source: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('network');
    expect((err as ApiError).status).toBe(-1);
    expect((err as ApiError).retriable).toBe(true);
  });

  it('attaches the source tag to error messages', async () => {
    fetchMock.mockResolvedValueOnce(bad(401));
    await expect(
      fetchJson('https://x/y', { source: 'aes' })
    ).rejects.toThrow(/aes HTTP 401/);
  });

  it('lets the caller override headers including Authorization', async () => {
    fetchMock.mockResolvedValueOnce(ok('{}'));
    await fetchJson('https://x/y', {
      source: 'x',
      headers: { Authorization: 'Bearer t', 'X-Custom': 'q' },
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer t');
    expect(headers['X-Custom']).toBe('q');
    // Default headers preserved when no collision.
    expect(headers['Cache-Control']).toContain('no-cache');
  });
});

describe('fetchText', () => {
  it('returns the body text on 200', async () => {
    fetchMock.mockResolvedValueOnce(ok('<html><body>ok</body></html>'));
    const out = await fetchText('https://x/y', { source: 'x' });
    expect(out).toContain('ok');
  });

  it('throws ApiError on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(bad(403));
    await expect(
      fetchText('https://x/y', { source: 'x' })
    ).rejects.toMatchObject({ status: 403 });
  });
});
