// ── ManualTournamentScreen ─────────────────────────────────────────────────
//
// Add / edit a manual tournament entry. The OVA + Volleyball Canada
// platforms don't index beach tournaments, so this form is the only way
// a beach pair's results enter the unified history today. Also accepts
// indoor entries for users importing prior seasons from PDF or paper
// standings.
//
// Layout:
//
//   [← Back]
//   New tournament                 [Save]
//   [Indoor / Beach toggle]
//
//   Tournament name *
//   [____________________________]
//   Subtitle (division)
//   [____________________________]
//   Date *      [date picker stub]
//   Venue
//   [____________________________]
//   Beach partner (beach only)
//   [____________________________]
//
//   RESULT
//   Final rank   [#]
//   Field size   [#]
//   Match record   [W] - [L]
//   Set record     [W] - [L]
//
//   Notes
//   [____________________________]
//
//   [Delete]                       [Save]
//
// Saved entries flow through unifiedSeasonHistory under source 'manual'
// — they show up in SeasonHistory, AthleteDetail per-sport stats, etc.,
// alongside indexed AES / Timu entries.
// ──────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';
import {
  makeManualTournamentId,
  saveManualTournament,
  removeManualTournament,
  type ManualTournamentEntry,
} from '../utils/manualTournaments';

interface Props {
  /** The team this entry belongs to. Required — sets tenantId + sport
   *  default + the canonical teamProfileId attachment. */
  team: TeamProfile;
  /** Existing entry to edit. When undefined, the form opens for a new
   *  entry pre-filled from `team` defaults. */
  existing?: ManualTournamentEntry;
  onBack: () => void;
  /** Called after a successful save. Parent typically navigates back. */
  onSaved: (entry: ManualTournamentEntry) => void;
  /** Called after a successful delete. Parent typically navigates back. */
  onDeleted?: (id: string) => void;
}

export function ManualTournamentScreen({
  team,
  existing,
  onBack,
  onSaved,
  onDeleted,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Defaults: indoor when team is indoor, beach when team is beach (or
  // when there's no team sport — beach is the headline use case so it
  // beats indoor on ties).
  const defaultSport = existing?.sport ?? team.sport ?? 'beach';

  const [sport, setSport] = useState<'indoor' | 'beach'>(defaultSport);
  const [tournamentName, setTournamentName] = useState(
    existing?.tournamentName ?? ''
  );
  const [subtitle, setSubtitle] = useState(existing?.subtitle ?? '');
  // Date is stored as ms; the UI uses a simple text field for the
  // first-pass shape (YYYY-MM-DD). A native date picker is a follow-up.
  const [dateText, setDateText] = useState(() => {
    const ms = existing?.dateMs ?? Date.now();
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [venueName, setVenueName] = useState(existing?.venueName ?? '');
  const [partnerName, setPartnerName] = useState(
    existing?.beachPartner?.name ?? ''
  );
  const [finalRank, setFinalRank] = useState(
    existing?.finalRank != null ? String(existing.finalRank) : ''
  );
  const [fieldSize, setFieldSize] = useState(
    existing?.fieldSize != null ? String(existing.fieldSize) : ''
  );
  const [matchesFor, setMatchesFor] = useState(
    existing?.matchesFor != null ? String(existing.matchesFor) : '0'
  );
  const [matchesAgainst, setMatchesAgainst] = useState(
    existing?.matchesAgainst != null ? String(existing.matchesAgainst) : '0'
  );
  const [setsFor, setSetsFor] = useState(
    existing?.setsFor != null ? String(existing.setsFor) : '0'
  );
  const [setsAgainst, setSetsAgainst] = useState(
    existing?.setsAgainst != null ? String(existing.setsAgainst) : '0'
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!tournamentName.trim()) {
      Alert.alert('Name required', 'Enter a tournament name.');
      return;
    }
    const dateMs = parseDateInput(dateText);
    if (dateMs == null) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD (e.g. 2026-07-12).');
      return;
    }
    const finalRankNum = parsePositiveInt(finalRank);
    const fieldSizeNum = parsePositiveInt(fieldSize);
    setSaving(true);
    try {
      const saved = await saveManualTournament({
        id: existing?.id ?? makeManualTournamentId(),
        tenantId: team.tenantId,
        teamProfileId: team.id,
        sport,
        tournamentName: tournamentName.trim(),
        subtitle: subtitle.trim() || undefined,
        dateMs,
        dateText: dateText.trim() || undefined,
        venueName: venueName.trim() || undefined,
        beachPartner:
          sport === 'beach' && partnerName.trim()
            ? { name: partnerName.trim() }
            : undefined,
        finalRank: finalRankNum ?? undefined,
        fieldSize: fieldSizeNum ?? undefined,
        matchesFor: parsePositiveInt(matchesFor) ?? 0,
        matchesAgainst: parsePositiveInt(matchesAgainst) ?? 0,
        setsFor: parsePositiveInt(setsFor) ?? 0,
        setsAgainst: parsePositiveInt(setsAgainst) ?? 0,
        notes: notes.trim() || undefined,
      });
      onSaved(saved);
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : '');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert(
      `Delete ${existing.tournamentName}?`,
      'This removes the entry from your history. You can re-add it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeManualTournament(existing.id);
              onDeleted?.(existing.id);
            } catch (err) {
              Alert.alert(
                'Delete failed',
                err instanceof Error ? err.message : ''
              );
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          activeOpacity={0.7}
        >
          <Text style={styles.saveBtnLabel}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>
        {existing ? 'Edit tournament' : 'New tournament'}
      </Text>
      <Text style={styles.subtitle}>{team.label}</Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Indoor / Beach toggle */}
        <View style={styles.tabRow}>
          <SportTab
            label="Indoor"
            active={sport === 'indoor'}
            onPress={() => setSport('indoor')}
            colors={colors}
          />
          <SportTab
            label="Beach"
            active={sport === 'beach'}
            onPress={() => setSport('beach')}
            colors={colors}
          />
        </View>

        <Field
          label="Tournament name *"
          value={tournamentName}
          onChangeText={setTournamentName}
          placeholder="OPVC Spring Slam"
          colors={colors}
        />
        <Field
          label="Subtitle"
          value={subtitle}
          onChangeText={setSubtitle}
          placeholder="Women 18U Tier 2"
          colors={colors}
        />
        <Field
          label="Date * (YYYY-MM-DD)"
          value={dateText}
          onChangeText={setDateText}
          placeholder="2026-07-12"
          colors={colors}
        />
        <Field
          label="Venue"
          value={venueName}
          onChangeText={setVenueName}
          placeholder="Markham PanAm Centre"
          colors={colors}
        />
        {sport === 'beach' ? (
          <Field
            label="Beach partner"
            value={partnerName}
            onChangeText={setPartnerName}
            placeholder="Lyevina"
            colors={colors}
          />
        ) : null}

        <Text style={styles.sectionLabel}>Result</Text>
        <View style={styles.rankRow}>
          <Field
            label="Final rank"
            value={finalRank}
            onChangeText={setFinalRank}
            placeholder="3"
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
          <Field
            label="Field size"
            value={fieldSize}
            onChangeText={setFieldSize}
            placeholder="12"
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
        </View>

        <View style={styles.rankRow}>
          <Field
            label="Matches won"
            value={matchesFor}
            onChangeText={setMatchesFor}
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
          <Field
            label="Matches lost"
            value={matchesAgainst}
            onChangeText={setMatchesAgainst}
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
        </View>

        <View style={styles.rankRow}>
          <Field
            label="Sets won"
            value={setsFor}
            onChangeText={setSetsFor}
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
          <Field
            label="Sets lost"
            value={setsAgainst}
            onChangeText={setSetsAgainst}
            keyboardType="number-pad"
            colors={colors}
            style={styles.rankCell}
          />
        </View>

        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Weather, partner swap, etc."
          colors={colors}
          multiline
        />

        {existing ? (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Text style={styles.deleteBtnLabel}>Delete tournament</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SportTab({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        sportTabStyles.tab,
        {
          backgroundColor: active ? colors.primary : 'transparent',
          borderColor: active ? colors.primary : colors.divider,
        },
      ]}
    >
      <Text
        style={[
          sportTabStyles.label,
          { color: active ? '#ffffff' : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  colors,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  multiline?: boolean;
  colors: ThemeColors;
  style?: object;
}) {
  return (
    <View style={[fieldStyles.wrap, style]}>
      <Text style={[fieldStyles.label, { color: colors.textLight }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        style={[
          fieldStyles.input,
          {
            color: colors.text,
            borderColor: colors.divider,
            backgroundColor: colors.surface,
          },
          multiline && fieldStyles.inputMultiline,
        ]}
      />
    </View>
  );
}

/** Parse YYYY-MM-DD into ms at local midnight. Returns null on bad input. */
function parseDateInput(text: string): number | null {
  const trimmed = text.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10);
  const d = parseInt(m[3]!, 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = new Date(y, mo - 1, d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Parse a non-negative integer from text. Empty → null, NaN → null. */
function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const sportTabStyles = StyleSheet.create({
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
});

const fieldStyles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
    },
    backBtn: {
      paddingVertical: spacing.xs,
    },
    backLabel: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    saveBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.primary,
    },
    saveBtnDisabled: {
      opacity: 0.6,
    },
    saveBtnLabel: {
      color: '#ffffff',
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    title: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.text,
      paddingHorizontal: spacing.md,
      marginTop: spacing.sm,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    scroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
    },
    tabRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    rankRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    rankCell: {
      flex: 1,
    },
    deleteBtn: {
      marginTop: spacing.lg,
      paddingVertical: spacing.md,
      alignItems: 'center',
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: '#c0392b',
    },
    deleteBtnLabel: {
      color: '#c0392b',
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
  });
}
