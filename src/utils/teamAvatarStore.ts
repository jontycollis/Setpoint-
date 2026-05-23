// ── Team avatar overrides ────────────────────────────────────────────────
//
// User-picked replacement images for the auto-generated team-tile avatars
// in the My Team(s) picker. The auto-generated avatar (initials + hashed
// color) is the default — this store only holds the *overrides* the user
// has explicitly picked. Cleared entries fall back to the default.
//
// Persisted as a single JSON blob keyed by `bior.teamAvatarOverrides.v1`,
// mapping `teamProfile.id → { uri, updatedAt }`. The uri is the LOCAL file
// URI returned by the image picker (`file://...`). We do NOT upload the
// image anywhere — it stays on the device, same posture as the rest of
// the user's profile / scored-match storage.
//
// Listeners can subscribe via `subscribeOverrides()` to re-render when the
// map changes. The hook `useTeamAvatarOverrides()` is the consumer-facing
// surface: it returns the current map and re-renders on change.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bior.teamAvatarOverrides.v1';

export interface TeamAvatarOverride {
  uri: string;
  updatedAt: number;
}

export type TeamAvatarOverrideMap = Record<string, TeamAvatarOverride>;

// In-memory cache so multiple consumers don't each hit AsyncStorage. The
// hook + every screen that reads overrides shares the same map.
let cache: TeamAvatarOverrideMap | null = null;
let loadPromise: Promise<TeamAvatarOverrideMap> | null = null;
const listeners = new Set<(map: TeamAvatarOverrideMap) => void>();

function notify(): void {
  const snapshot = cache ?? {};
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // Listener bugs shouldn't break sibling subscribers.
    }
  }
}

async function readFromStorage(): Promise<TeamAvatarOverrideMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: TeamAvatarOverrideMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as { uri?: unknown; updatedAt?: unknown };
      if (typeof entry.uri !== 'string' || !entry.uri) continue;
      const updatedAt =
        typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now();
      out[id] = { uri: entry.uri, updatedAt };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeToStorage(map: TeamAvatarOverrideMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Best-effort; the in-memory cache still carries the change so the
    // session sees the update — a later setOverride will retry the write.
  }
}

/**
 * Returns the current override map. First call hydrates from AsyncStorage;
 * subsequent calls return the cached map immediately.
 */
export async function loadOverrides(): Promise<TeamAvatarOverrideMap> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = readFromStorage().then((map) => {
      cache = map;
      return map;
    });
  }
  return loadPromise;
}

/** Synchronous snapshot of the cache. Empty until `loadOverrides()` resolves. */
export function getOverridesSnapshot(): TeamAvatarOverrideMap {
  return cache ?? {};
}

/**
 * Persist a new override for `teamProfileId`. Notifies subscribers
 * immediately from the in-memory cache; the AsyncStorage write happens in
 * the background.
 */
export async function setOverride(
  teamProfileId: string,
  uri: string
): Promise<void> {
  const map = await loadOverrides();
  const next = { ...map, [teamProfileId]: { uri, updatedAt: Date.now() } };
  cache = next;
  notify();
  await writeToStorage(next);
}

/** Drop the override for `teamProfileId`, reverting to the auto-generated avatar. */
export async function clearOverride(teamProfileId: string): Promise<void> {
  const map = await loadOverrides();
  if (!(teamProfileId in map)) return;
  const next = { ...map };
  delete next[teamProfileId];
  cache = next;
  notify();
  await writeToStorage(next);
}

/**
 * Subscribe to override changes. Returns an unsubscribe function. The
 * listener is invoked synchronously after every set/clear with the new
 * map snapshot.
 */
export function subscribeOverrides(
  listener: (map: TeamAvatarOverrideMap) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook: returns the current override map and re-renders the
 * subscribing component whenever it changes. Hydrates from AsyncStorage
 * on first mount.
 */
export function useTeamAvatarOverrides(): TeamAvatarOverrideMap {
  const [map, setMap] = useState<TeamAvatarOverrideMap>(() =>
    getOverridesSnapshot()
  );
  useEffect(() => {
    let active = true;
    loadOverrides().then((loaded) => {
      if (active) setMap(loaded);
    });
    const unsubscribe = subscribeOverrides((next) => {
      if (active) setMap(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return map;
}

/** Test helper — reset module state. Not exported through any barrel. */
export function __resetTeamAvatarStoreForTests(): void {
  cache = null;
  loadPromise = null;
  listeners.clear();
}
