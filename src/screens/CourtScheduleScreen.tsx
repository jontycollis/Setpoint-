import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import {
  getCourtSchedule,
  getUtilizedDates,
  flattenCourtSchedule,
} from '../api/aesClient';
import type { UtilizedDate, FlatCourtMatch } from '../api/aesClient';
import { formatDate, formatTime } from '../utils/dates';
import type { AESEvent } from '../types/aes';

interface Props {
  event: AESEvent;
  myTeamId?: number;
  myTeamText?: string;
  onBack: () => void;
}

export function CourtScheduleScreen({ event, myTeamId, myTeamText, onBack }: Props) {
  const [dates, setDates] = useState<UtilizedDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [allMatches, setAllMatches] = useState<FlatCourtMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDates();
  }, []);

  useEffect(() => {
    if (selectedDate) loadSchedule(selectedDate);
  }, [selectedDate]);

  async function loadDates() {
    try {
      const utilDates = await getUtilizedDates(event.Key);
      setDates(utilDates);
      // Select current day or first day
      const current = utilDates.find((d) => d.IsCurrent);
      setSelectedDate(current?.DateTime || utilDates[0]?.DateTime || '');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function loadSchedule(date: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await getCourtSchedule(event.Key, date);
      const flat = flattenCourtSchedule(data);
      setAllMatches(flat);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Group matches by court name
  const courtGroups: Record<string, FlatCourtMatch[]> = {};
  allMatches.forEach((match) => {
    const courtName = match.CourtName || 'Unknown';
    if (!courtGroups[courtName]) courtGroups[courtName] = [];
    courtGroups[courtName].push(match);
  });

  function isMyTeamMatch(match: FlatCourtMatch): boolean {
    if (!myTeamText) return false;
    const search = myTeamText.toLowerCase();
    return (
      match.FirstTeamText.toLowerCase() === search ||
      match.SecondTeamText.toLowerCase() === search
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Court Schedule</Text>
      </View>

      {/* Date Selector */}
      <ScrollView
        horizontal
        style={styles.datePicker}
        showsHorizontalScrollIndicator={false}
      >
        {dates.map((dateObj) => (
          <TouchableOpacity
            key={dateObj.DateTime}
            style={[
              styles.dateChip,
              selectedDate === dateObj.DateTime && styles.dateChipActive,
            ]}
            onPress={() => setSelectedDate(dateObj.DateTime)}
          >
            <Text
              style={[
                styles.dateChipText,
                selectedDate === dateObj.DateTime && styles.dateChipTextActive,
              ]}
            >
              {formatDate(dateObj.DateTime)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.scheduleScroll}>
          {Object.entries(courtGroups).map(([courtName, matches]) => (
            <View key={courtName} style={styles.courtSection}>
              <View style={styles.courtHeader}>
                <Text style={styles.courtName}>{courtName}</Text>
              </View>
              {matches.map((match) => {
                const isMyMatch = isMyTeamMatch(match);
                return (
                  <View
                    key={match.MatchId}
                    style={[
                      styles.scheduleEntry,
                      isMyMatch && styles.scheduleEntryHighlight,
                    ]}
                  >
                    <Text style={styles.entryTime}>
                      {formatTime(match.ScheduledStartDateTime)}
                    </Text>
                    <View style={styles.entryDetails}>
                      <Text style={styles.entryDivision} numberOfLines={1}>
                        {match.Division.Name}
                      </Text>
                      <Text
                        style={[
                          styles.entryTeams,
                          isMyMatch && styles.entryTeamsHighlight,
                        ]}
                        numberOfLines={1}
                      >
                        {match.FirstTeamText} vs {match.SecondTeamText}
                      </Text>
                    </View>
                    {match.HasOutcome && (
                      <View style={styles.completedDot} />
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          {allMatches.length === 0 && !error && (
            <View style={styles.centered}>
              <Text style={styles.noData}>No court schedule available for this date.</Text>
            </View>
          )}

          <View style={{ height: spacing.xxxl }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg },
  backText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  errorText: { fontSize: fontSize.md, color: colors.loss, textAlign: 'center' },
  datePicker: {
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dateChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateChipText: { fontSize: fontSize.md, color: colors.text, fontWeight: '500' },
  dateChipTextActive: { color: colors.textOnPrimary, fontWeight: '700' },
  scheduleScroll: { flex: 1 },
  courtSection: { marginBottom: spacing.md },
  courtHeader: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  courtName: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  scheduleEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  scheduleEntryHighlight: {
    backgroundColor: '#fff8e1',
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  entryTime: { width: 80, fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  entryDetails: { flex: 1 },
  entryDivision: { fontSize: fontSize.xs, color: colors.textLight },
  entryTeams: { fontSize: fontSize.sm, color: colors.text, marginTop: 2 },
  entryTeamsHighlight: { fontWeight: '700', color: colors.accent },
  completedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.win,
    marginLeft: spacing.sm,
  },
  noData: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
});
