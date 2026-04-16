import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { formatDateRange } from '../utils/dates';
import type { AESEvent, AESDivision } from '../types/aes';

interface Props {
  event: AESEvent;
  onDivisionSelected: (division: AESDivision) => void;
  onBack: () => void;
}

export function DivisionSelectScreen({ event, onDivisionSelected, onBack }: Props) {
  function renderDivision({ item }: { item: AESDivision }) {
    return (
      <TouchableOpacity
        style={styles.divisionCard}
        onPress={() => onDivisionSelected(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.colorBar, { backgroundColor: item.ColorHex }]} />
        <View style={styles.divisionInfo}>
          <Text style={styles.divisionName}>{item.Name}</Text>
          <Text style={styles.divisionMeta}>
            {item.TeamCount} teams
          </Text>
        </View>
        <Text style={styles.arrow}>{'>'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.eventHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.eventName} numberOfLines={2}>{event.Name}</Text>
        <Text style={styles.eventMeta}>
          {formatDateRange(event.StartDate, event.EndDate)}
        </Text>
        <Text style={styles.eventLocation} numberOfLines={1}>{event.Location}</Text>
      </View>

      <Text style={styles.sectionTitle}>Select Division</Text>

      <FlatList
        data={event.Divisions}
        keyExtractor={(item) => String(item.DivisionId)}
        renderItem={renderDivision}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  eventHeader: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingTop: spacing.lg,
  },
  backButton: { marginBottom: spacing.sm },
  backText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  eventName: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
  },
  eventMeta: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: spacing.xs,
  },
  eventLocation: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  divisionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  colorBar: { width: 5, alignSelf: 'stretch' },
  divisionInfo: { flex: 1, padding: spacing.lg },
  divisionName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  divisionMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  arrow: {
    fontSize: 20,
    color: colors.textLight,
    paddingRight: spacing.lg,
  },
});
