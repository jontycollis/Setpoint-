// ── Recently Viewed ───────────────────────────────────────────────────────
//
// Persists the last few tournaments / teams the user opened so MyHome can
// surface a "Recently viewed" strip and the user can jump straight back to
// recent screens.
//
// Storage: AsyncStorage at `setpoint.recentlyViewed.v1`. Capped at 10
// entries with FIFO eviction (oldest evicted when adding the 11th).
// Same-key entries are de-duped on push (the touched entry moves to the
// front, preserving "most recent first" ordering).
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'setpoint.recentlyViewed.v1';
export const RECENTLY_VIEWED_MAX = 10;

// ── Types ─────────────────────────────────────────────────────────────────
//
// A discriminated union so MyHome / search can render each kind without
// guesswork, and the navigation handler in App.tsx can dispatch by kind.

export type RecentItem =
  | RecentTeamAes
  | RecentTeamTimu
  | RecentTournamentAes
  | RecentTournamentTimu;

export interface RecentTeamAes {
  kind: 'team-aes';
  /** AES event key. */
  eventKey: string;
  divisionId: number;
  teamId: number;
  /** Display label — "Defensa U18 Rob". */
  label: string;
  /** Subtitle for the strip — "{divisionName} · {eventName}". */
  subtitle?: string;
  divisionColorHex?: string;
  /** Epoch ms when the entry was last touched. */
  touchedAt: number;
}

export interface RecentTeamTimu {
  kind: 'team-timu';
  tid: number;
  teamName: string;
  label: string;
  subtitle?: string;
  touchedAt: number;
}

export interface RecentTournamentAes {
  kind: 'tournament-aes';
  eventKey: string;
  label: string;
  subtitle?: string;
  touchedAt: number;
}

export interface RecentTournamentTimu {
  kind: 'tournament-timu';
  tid: number;
  label: string;
  subtitle?: string;
  touchedAt: number;
}

// ── Identity (for de-dup on push) ─────────────────────────────────────────

export function recentItemKey(item: RecentItem): string {
  switch (item.kind) {
    case 'team-aes':
      return `team-aes:${item.eventKey}:${item.divisionId}:${item.teamId}`;
    case 'team-timu':
      return `team-timu:${item.tid}:${item.teamName.toLowerCase().trim()}`;
    case 'tournament-aes':
      return `tournament-aes:${item.eventKey}`;
    case 'tournament-timu':
      return `tournament-timu:${item.tid}`;
  }
}

// ── Storage ───────────────────────────────────────────────────────────────

async function readList(): Promise<RecentItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentItem =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as RecentItem).kind === 'string'
    );
  } catch {
    return [];
  }
}

async function writeList(list: RecentItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export async function loadRecentlyViewed(): Promise<RecentItem[]> {
  return readList();
}

/**
 * Push an entry to the front. If the same identity is already present it's
 * removed first so the touched entry ends up at index 0. List is capped at
 * RECENTLY_VIEWED_MAX (oldest dropped).
 *
 * Returns the resulting list so callers can update local state without a
 * second read.
 */
export async function pushRecentlyViewed(item: RecentItem): Promise<RecentItem[]> {
  const stamped: RecentItem = { ...item, touchedAt: Date.now() };
  const cur = await readList();
  const key = recentItemKey(stamped);
  const filtered = cur.filter((e) => recentItemKey(e) !== key);
  const next = [stamped, ...filtered].slice(0, RECENTLY_VIEWED_MAX);
  await writeList(next);
  return next;
}

export async function clearRecentlyViewed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Subscription ──────────────────────────────────────────────────────────
//
// Tiny in-process pub/sub so MyHome's strip refreshes immediately after
// `pushRecentlyViewed` is called from a navigation handler — no
// re-mount-on-focus needed.

type Listener = (list: RecentItem[]) => void;
const listeners = new Set<Listener>();

function notify(list: RecentItem[]): void {
  for (const fn of listeners) fn(list);
}

// Wrap the pusher so writes broadcast.
const _pushOriginal = pushRecentlyViewed;
export async function pushRecentlyViewedAndNotify(
  item: RecentItem
): Promise<RecentItem[]> {
  const next = await _pushOriginal(item);
  notify(next);
  return next;
}

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * MyHome subscribes via this hook. Reads once on mount, then refreshes
 * whenever `pushRecentlyViewedAndNotify` fires. `limit` defaults to
 * RECENTLY_VIEWED_MAX so callers that want all entries don't have to set it.
 */
export function useRecentlyViewed(limit: number = RECENTLY_VIEWED_MAX): RecentItem[] {
  const [list, setList] = useState<RecentItem[]>([]);

  const refresh = useCallback(async () => {
    const cur = await loadRecentlyViewed();
    setList(cur);
  }, []);

  useEffect(() => {
    refresh();
    const fn: Listener = (next) => setList(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [refresh]);

  return list.slice(0, limit);
}
