// ── Display-tz preference ──────────────────────────────────────────────────
//
// User toggle for venue-local vs device-local rendering. Default is
// `'venue'` — most users want to see schedule times in the venue's tz
// (a 9 AM match is "9 AM at the gym", not "6 AM at home for the West-coast
// parent watching from afar"). The "Show in my time" toggle on
// TeamDashboard flips this to `'device'`.
//
// Storage: AsyncStorage at `setpoint.tzDisplayMode.v1`. Read once on mount
// via the `useTzDisplayMode` hook; writes go through `setTzDisplayMode`.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'setpoint.tzDisplayMode.v1';

export type TzDisplayMode = 'venue' | 'device';

/** Default: render in the venue tz (falls back to device when no tz known). */
export const DEFAULT_TZ_DISPLAY_MODE: TzDisplayMode = 'venue';

export async function readTzDisplayMode(): Promise<TzDisplayMode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === 'device' || raw === 'venue') return raw;
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
 * React hook: returns `[mode, setMode]`. Mode is `'venue'` until the
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
 * Resolve which tz a formatter should use given the user's preference and
 * the venue's tz. Returns `undefined` (= device-local) when the user is in
 * 'device' mode or the venue tz is unknown.
 */
export function effectiveTzForDisplay(
  mode: TzDisplayMode,
  venueTimeZone: string | undefined
): string | undefined {
  if (mode === 'device') return undefined;
  return venueTimeZone || undefined;
}
