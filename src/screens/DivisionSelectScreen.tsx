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
  onSearchTeams?: () => void;
}

export function DivisionSelectScreen({ event, onDivisionSelected, onBack, onSearchTeams }: Props) {
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
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.eventName} numberOfLines={2}>{event.Name}</Text>
        <Text style={styles.eventMeta}>
          {formatDateRange(event.StartDate, event.EndDate)}
        </Text>
        <Text style={styles.eventLocation} numberOfLines={1}>{event.Location}</Text>
      </View>

      {onSearchTeams && (
        <TouchableOpacity style={styles.searchButton} onPress={onSearchTeams} activeOpacity={0.7}>
          <Text style={styles.searchButtonText}>Search All Teams</Text>
        </TouchableOpacity>
      )}

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
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  backButton: { marginBottom: spacing.sm },
  backText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  eventName: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
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
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  searchButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
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
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  colorBar: { width: 5, alignSelf: 'stretch', borderTopLeftRadius: borderRadius.lg, borderBottomLeftRadius: borderRadius.lg },
  divisionInfo: { flex: 1, padding: spacing.lg },
  divisionName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
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
