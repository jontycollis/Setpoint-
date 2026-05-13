// ── Analytics view preference (persisted) ─────────────────────────────────
//
// Persists the user's choice on the StatsScreen "Pick view" chips so the
// dashboard opens to the same configuration on every launch. Two
// dimensions:
//   • splitsAxis  — which axis the top-of-screen stripe pivots on
//                   (matchCategory / matchKind / phase / source)
//   • metricSet   — which family of cards renders
//                   (basic / advanced / lineups)
//
// Defaults to `matchCategory` + `advanced` per the workbook port — the
// user's PVC workbook already uses the category labels as the primary
// splits axis and shows the on-court / serve / set-win metrics by
// default, so the app matches.
// ──────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'analytics.viewPreference.v1';

export type AnalyticsSplitsAxis =
  | 'matchCategory'
  | 'matchKind'
  | 'phase'
  | 'source';

export type AnalyticsMetricSet = 'basic' | 'advanced' | 'lineups';

export interface AnalyticsViewPreference {
  splitsAxis: AnalyticsSplitsAxis;
  metricSet: AnalyticsMetricSet;
}

export const DEFAULT_ANALYTICS_VIEW_PREFERENCE: AnalyticsViewPreference = {
  splitsAxis: 'matchCategory',
  metricSet: 'advanced',
};

const VALID_AXES: ReadonlySet<AnalyticsSplitsAxis> = new Set<AnalyticsSplitsAxis>([
  'matchCategory',
  'matchKind',
  'phase',
  'source',
]);
const VALID_METRIC_SETS: ReadonlySet<AnalyticsMetricSet> = new Set<AnalyticsMetricSet>([
  'basic',
  'advanced',
  'lineups',
]);

function sanitise(raw: unknown): AnalyticsViewPreference {
  if (!raw || typeof raw !== 'object') return DEFAULT_ANALYTICS_VIEW_PREFERENCE;
  const obj = raw as Partial<AnalyticsViewPreference>;
  const axis: AnalyticsSplitsAxis =
    obj.splitsAxis && VALID_AXES.has(obj.splitsAxis)
      ? obj.splitsAxis
      : DEFAULT_ANALYTICS_VIEW_PREFERENCE.splitsAxis;
  const metricSet: AnalyticsMetricSet =
    obj.metricSet && VALID_METRIC_SETS.has(obj.metricSet)
      ? obj.metricSet
      : DEFAULT_ANALYTICS_VIEW_PREFERENCE.metricSet;
  return { splitsAxis: axis, metricSet };
}

export async function loadAnalyticsViewPreference(): Promise<AnalyticsViewPreference> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ANALYTICS_VIEW_PREFERENCE;
    return sanitise(JSON.parse(raw));
  } catch {
    return DEFAULT_ANALYTICS_VIEW_PREFERENCE;
  }
}

export async function saveAnalyticsViewPreference(
  pref: AnalyticsViewPreference
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sanitise(pref)));
  } catch {
    // Best-effort. Persistence failures shouldn't break the UI; the
    // user just loses the choice across launches.
  }
}
