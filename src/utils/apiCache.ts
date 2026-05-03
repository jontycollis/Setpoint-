/**
 * Offline-first API cache layer.
 *
 * Strategy:
 * 1. On every successful API fetch, cache the response in AsyncStorage.
 * 2. On fetch failure (network error), serve the cached version if available.
 * 3. Each cache entry has a TTL — if the cache is fresh, skip the network
 *    call entirely to reduce API load and improve perceived speed.
 * 4. Callers can force a refresh (e.g. pull-to-refresh) to bypass TTL.
 *
 * Cache keys follow the pattern: `cache.<endpoint>.<params-hash>`
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  timestamp: number; // ms since epoch
}

const DEFAULT_TTL = 60_000; // 1 minute — reasonable for live tournament data

/**
 * Build a deterministic cache key from an endpoint and params object.
 */
function buildCacheKey(endpoint: string, params?: Record<string, any>): string {
  const paramStr = params ? JSON.stringify(params, Object.keys(params).sort()) : '';
  return `cache.${endpoint}.${paramStr}`;
}

/**
 * Read from cache. Returns null if missing or expired (unless ignoreExpiry).
 */
async function readCache<T>(
  key: string,
  ttl: number,
  ignoreExpiry = false
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (!ignoreExpiry && Date.now() - entry.timestamp > ttl) {
      return null; // Expired
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Write to cache.
 */
async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage full or other issue — silently fail
  }
}

export interface CacheFetchOptions {
  /** Time-to-live in ms before cache is considered stale (default 60s) */
  ttl?: number;
  /** Force network fetch, ignoring cache TTL (pull-to-refresh) */
  forceRefresh?: boolean;
}

/**
 * Fetch with cache-first strategy:
 * 1. If cache is fresh and !forceRefresh → return cached data
 * 2. Try network fetch → on success, cache + return
 * 3. On failure → return stale cache (any age) or throw
 */
export async function cachedFetch<T>(
  endpoint: string,
  params: Record<string, any> | undefined,
  fetchFn: () => Promise<T>,
  options?: CacheFetchOptions
): Promise<T> {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const forceRefresh = options?.forceRefresh ?? false;
  const key = buildCacheKey(endpoint, params);

  // Step 1: Check fresh cache (skip if force-refresh)
  if (!forceRefresh) {
    const fresh = await readCache<T>(key, ttl);
    if (fresh !== null) return fresh;
  }

  // Step 2: Try network
  try {
    const data = await fetchFn();
    // Cache the successful response (fire-and-forget)
    writeCache(key, data);
    return data;
  } catch (networkError) {
    // Step 3: Fall back to stale cache
    const stale = await readCache<T>(key, ttl, true);
    if (stale !== null) {
      return stale;
    }
    throw networkError; // No cache at all — propagate error
  }
}

/**
 * Clear all cache entries. Useful for debugging or when user logs out.
 */
export async function clearApiCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith('cache.'));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // Ignore
  }
}

/**
 * Get cache info for debugging.
 */
export async function getCacheStats(): Promise<{
  entryCount: number;
  oldestMs: number | null;
}> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith('cache.'));
    let oldest: number | null = null;
    for (const key of cacheKeys.slice(0, 20)) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const entry = JSON.parse(raw);
        if (oldest === null || entry.timestamp < oldest) {
          oldest = entry.timestamp;
        }
      }
    }
    return { entryCount: cacheKeys.length, oldestMs: oldest };
  } catch {
    return { entryCount: 0, oldestMs: null };
  }
}
