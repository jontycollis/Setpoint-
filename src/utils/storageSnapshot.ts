// ── Pre-migration AsyncStorage snapshots ───────────────────────────────────
//
// Defensive backup so future migrations can be rolled back. On cold-start
// we snapshot every AsyncStorage key under `setpoint.snapshot.<unix-ts>`,
// keep the two most recent, and expose `restoreSnapshot` for the user to
// roll back via the Settings → "Restore from backup" affordance.
//
// Snapshot value format: JSON of an array of `[key, value]` pairs. We
// store everything as raw strings (AsyncStorage's native shape) so the
// roundtrip is lossless — no JSON.parse / re-stringify of individual
// values, which could mangle anything stored as a non-JSON string.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const SNAPSHOT_PREFIX = 'setpoint.snapshot.';

export interface SnapshotInfo {
  key: string;
  takenAt: number;
  totalBytes: number;
}

function isSnapshotKey(key: string): boolean {
  return key.startsWith(SNAPSHOT_PREFIX);
}

function parseTakenAt(key: string): number {
  const tail = key.slice(SNAPSHOT_PREFIX.length);
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read every AsyncStorage key (excluding existing snapshots) and write
 * the pairs as a single JSON blob under `setpoint.snapshot.<ts>`. Returns
 * the new snapshot key plus a manifest for logging / display.
 */
export async function takePreMigrationSnapshot(): Promise<{
  snapshotKey: string;
  keys: string[];
  totalBytes: number;
}> {
  const allKeys = await AsyncStorage.getAllKeys();
  const targetKeys = allKeys.filter((k) => !isSnapshotKey(k));
  const pairs = await AsyncStorage.multiGet(targetKeys);
  // multiGet returns Array<[key, value | null]>. Filter out null values
  // so the snapshot blob is clean — null-valued keys mean "absent".
  const cleaned: Array<[string, string]> = [];
  for (const [k, v] of pairs) {
    if (v != null) cleaned.push([k, v]);
  }
  const ts = Date.now();
  const snapshotKey = `${SNAPSHOT_PREFIX}${ts}`;
  const blob = JSON.stringify(cleaned);
  await AsyncStorage.setItem(snapshotKey, blob);
  return {
    snapshotKey,
    keys: cleaned.map((p) => p[0]),
    totalBytes: blob.length,
  };
}

/**
 * Enumerate all snapshot keys, returning their metadata sorted
 * most-recent-first. Snapshots without a parseable timestamp are
 * placed at the end.
 */
export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const snapshotKeys = allKeys.filter(isSnapshotKey);
  const pairs = await AsyncStorage.multiGet(snapshotKeys);
  const out: SnapshotInfo[] = pairs.map(([k, v]) => ({
    key: k,
    takenAt: parseTakenAt(k),
    totalBytes: v ? v.length : 0,
  }));
  out.sort((a, b) => b.takenAt - a.takenAt);
  return out;
}

/**
 * Delete all but the N most recent snapshot keys. Returns the count
 * deleted. N defaults to 2.
 */
export async function pruneSnapshots(keepN = 2): Promise<number> {
  const snaps = await listSnapshots();
  if (snaps.length <= keepN) return 0;
  const toDelete = snaps.slice(keepN).map((s) => s.key);
  await AsyncStorage.multiRemove(toDelete);
  return toDelete.length;
}

/**
 * Read a snapshot by key and write every contained `[k, v]` pair back to
 * AsyncStorage, overwriting current values. The snapshot's own key is
 * left in place — restoring shouldn't delete the breadcrumb that
 * recorded the restore.
 */
export async function restoreSnapshot(key: string): Promise<void> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) throw new Error(`Snapshot ${key} not found.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Snapshot ${key} is corrupt (not valid JSON).`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Snapshot ${key} is malformed (expected array).`);
  }
  const pairs: Array<[string, string]> = [];
  for (const entry of parsed) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      entry[0] !== key
    ) {
      pairs.push([entry[0], entry[1]]);
    }
  }
  if (pairs.length > 0) {
    await AsyncStorage.multiSet(pairs);
  }
}
