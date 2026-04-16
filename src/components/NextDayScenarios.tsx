import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { getTeamFutureSchedule } from '../api/aesClient';
import type { TeamFutureScheduleRow } from '../api/aesClient';
import { Card } from './Card';
import { formatTime, formatDate } from '../utils/dates';

interface Props {
  eventKey: string;
  divisionId: number;
  divisionName: string;
  teamId: number;
  myPoolShortName?: string;
  myFinishRank?: number | null;
}

export function NextDayScenarios({
  eventKey,
  divisionId,
  divisionName,
  teamId,
  myPoolShortName,
  myFinishRank,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TeamFutureScheduleRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFutureSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey, divisionId, teamId]);

  async function loadFutureSchedule() {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeamFutureSchedule(eventKey, divisionId, teamId);
      setRows(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load future schedule.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Looking up future matches...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <Card variant="outlined" style={styles.noData}>
        <Text style={styles.noDataTitle}>Future matches unavailable</Text>
        <Text style={styles.noDataHint}>{error}</Text>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card variant="outlined" style={styles.noData}>
        <Text style={styles.noDataTitle}>
          No future matches posted yet.
        </Text>
        <Text style={styles.noDataHint}>
          Future {divisionName} matches will appear here once the bracket or next-day pools are published.
        </Text>
      </Card>
    );
  }

  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return (
    <View>
      <Text style={styles.disclaimer}>
        Based on how you finish your current schedule.
      </Text>
      {rows.map((row) => {
        const rankHit = myFinishRank != null && myFinishRank === row.PotentialRank;
        const nextMatch = row.NextMatch;
        const nextPlay = row.NextPlay;
        const workMatch = row.WorkMatch;

        return (
          <Card
            key={`rank-${row.PotentialRank}`}
            variant="outlined"
            style={{
              ...styles.scenarioCard,
              ...(rankHit ? styles.scenarioCardHit : {}),
            }}
          >
            <View style={styles.ifRow}>
              <View
                style={[
                  styles.rankBadge,
                  rankHit && styles.rankBadgeHit,
                ]}
              >
                <Text
                  style={[
                    styles.rankBadgeText,
                    rankHit && styles.rankBadgeTextHit,
                  ]}
                >
                  {ordinal(row.PotentialRank)}
                </Text>
              </View>
              <Text style={styles.ifText}>
                If you finish {ordinal(row.PotentialRank)}
                {myPoolShortName ? ` in Pool ${myPoolShortName}` : ''}
              </Text>
            </View>

            {/* Next pool/bracket assignment */}
            {nextPlay && (
              <Text style={styles.nextPlayText} numberOfLines={1}>
                {nextPlay.CompleteFullName || nextPlay.FullName}
              </Text>
            )}

            {/* Match time and court */}
            {nextMatch && (
              <View style={styles.scenarioHeader}>
                <Text style={styles.timeText}>
                  {formatDate(nextMatch.ScheduledStartDateTime)}{' '}
                  {formatTime(nextMatch.ScheduledStartDateTime)}
                </Text>
                {nextMatch.Court && (
                  <View style={styles.courtBadge}>
                    <Text style={styles.courtBadgeText}>
                      {nextMatch.Court.Name}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Work assignment */}
            {workMatch ? (
              <Text style={styles.workLine}>
                Work: {formatTime(workMatch.ScheduledStartDateTime)}{' '}
                {workMatch.Court?.Name || ''}
              </Text>
            ) : (
              <Text style={styles.workLine}>No Future Assignment</Text>
            )}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  loadingText: {
    marginLeft: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  scenarioCard: {
    marginBottom: spacing.sm,
  },
  scenarioCardHit: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(255,107,53,0.06)',
  },
  ifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  rankBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  rankBadgeHit: {
    backgroundColor: colors.accent,
  },
  rankBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  rankBadgeTextHit: {
    color: colors.textOnPrimary,
  },
  ifText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  nextPlayText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  scenarioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  timeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  courtBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  courtBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  workLine: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  disclaimer: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  noData: {
    padding: spacing.md,
  },
  noDataTitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  noDataHint: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    marginTop: spacing.xs,
  },
});
