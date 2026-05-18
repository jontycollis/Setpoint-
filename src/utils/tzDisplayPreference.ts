// ── Display-tz preference ──────────────────────────────────────────────────
//
// User toggle for venue-local vs device-local vs *dual* rendering. Default
// is `'dual'` — schedule times render in the venue's tz with the user's
// own time alongside in parens when the two tzs differ at that instant.
// (A 3 PM EST match for a Vancouver user shows `"3:00 PM (12:00 PM PDT)"`,
// while a Toronto user just sees `"3:00 PM"`.)
//
// The TeamDashboard "Show in my time" row cycles 'dual' → 'venue' →
// 'device' → 'dual' for power users who want a single-line view.
//
// Storage: AsyncStorage at `setpoint.tzDisplayMode.v2`. The v2 bump
// migrates everyone off the legacy v1 default of `'venue'` to the new
// `'dual'` default — the timezone-overhaul feature shipped only days ago,
// so the cost of resetting the few users who had toggled it is small
// compared to the surprise of seeing single-line behaviour after the
// dual-display change lands.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'setpoint.tzDisplayMode.v2';

export type TzDisplayMode = 'dual' | 'venue' | 'device';

/** Default: dual — venue tz primary, user tz in parens when they differ. */
export const DEFAULT_TZ_DISPLAY_MODE: TzDisplayMode = 'dual';

export async function readTzDisplayMode(): Promise<TzDisplayMode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === 'device' || raw === 'venue' || raw === 'dual') return raw;
    return DEFAULT_TZ_DISPLAY_MODE;
  } catch {
    return DEFAULT_TZ_DISPLAY_MODE;
  }
}

export async function writeTzDisplayMode(mode: TzDisplayMode): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/**
 * React hook: returns `[mode, setMode]`. Mode is `'dual'` until the
 * persisted value finishes loading from AsyncStorage, then flips to
 * whatever the user last picked.
 */
export function useTzDisplayMode(): [TzDisplayMode, (next: TzDisplayMode) => void] {
  const [mode, setMode] = useState<TzDisplayMode>(DEFAULT_TZ_DISPLAY_MODE);
  useEffect(() => {
    readTzDisplayMode().then(setMode);
  }, []);
  const set = useCallback((next: TzDisplayMode) => {
    setMode(next);
    writeTzDisplayMode(next);
  }, []);
  return [mode, set];
}

/**
 * Resolve which tz a *single-string* formatter should use given the
 * user's preference and the venue's tz. Returns `undefined`
 * (= device-local) when the user is in 'device' mode or the venue tz is
 * unknown; otherwise returns the venue tz.
 *
 * Use this for formatters that always emit one string (sort keys, log
 * lines, header subtitles). For user-facing match-time displays prefer
 * `formatDualTime(ms, venueTz, opts, mode)` directly so 'dual' mode can
 * surface both tzs in the same line.
 */
export function effectiveTzForDisplay(
  mode: TzDisplayMode,
  venueTimeZone: string | undefined
): string | undefined {
  if (mode === 'device') return undefined;
  return venueTimeZone || undefined;
}

/** Advance the 3-state cycle. Called from the TeamDashboard toggle row. */
export function nextTzDisplayMode(mode: TzDisplayMode): TzDisplayMode {
  if (mode === 'dual') return 'venue';
  if (mode === 'venue') return 'device';
  return 'dual';
}
