// ── TeamRosterScreen ──────────────────────────────────────────────────────
//
// Edits the persistent roster on a single TeamProfile. Saves to
// `TeamProfile.roster` + `rosterUpdatedAt` via the App-level callback,
// which writes through `saveUserProfile`.
//
// Soft-delete on long-press (active: false) preserves historical
// references to a player from prior matches; inactive players are hidden
// by default and re-enable through the "Show inactive" toggle.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';
import type { RosterPlayer } from '../types/match';

type Position = NonNullable<RosterPlayer['position']>;
const POSITION_OPTIONS: Array<Position | ''> = ['', 'S', 'OH', 'MB', 'OPP', 'L', 'DS'];

interface DraftPlayer {
  /** Stable client-only id so React keys survive re-orders / removals. */
  rowId: string;
  shirtStr: string;
  name: string;
  isLibero: boolean;
  isCaptain: boolean;
  position?: Position;
  active: boolean;
  source: 'manual' | 'mrs-api';
}

interface Props {
  team: TeamProfile;
  onCancel: () => void;
  /** Persists the next roster on the active TeamProfile. */
  onSave: (next: { roster: RosterPlayer[]; rosterUpdatedAt: number }) => void;
}

function makeRowId(): string {
  return `r_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function fromRosterPlayer(p: RosterPlayer): DraftPlayer {
  return {
    rowId: makeRowId(),
    shirtStr: String(p.shirt),
    name: p.name,
    isLibero: p.isLibero,
    isCaptain: !!p.isCaptain,
    position: p.position,
    active: p.active,
    source: p.source ?? 'manual',
  };
}

function emptyDraftPlayer(): DraftPlayer {
  return {
    rowId: makeRowId(),
    shirtStr: '',
    name: '',
    isLibero: false,
    isCaptain: false,
    position: undefined,
    active: true,
    source: 'manual',
  };
}

export function TeamRosterScreen({ team, onCancel, onSave }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [players, setPlayers] = useState<DraftPlayer[]>(() =>
    (team.roster ?? []).map(fromRosterPlayer)
  );
  const [showInactive, setShowInactive] = useState(false);

  const visiblePlayers = showInactive ? players : players.filter((p) => p.active);

  function patchPlayer(rowId: string, patch: Partial<DraftPlayer>) {
    setPlayers((prev) => prev.map((p) => (p.rowId === rowId ? { ...p, ...patch } : p)));
  }

  function addPlayer() {
    setPlayers((prev) => [...prev, emptyDraftPlayer()]);
  }

  function softDeletePlayer(rowId: string) {
    const p = players.find((x) => x.rowId === rowId);
    if (!p) return;
    Alert.alert(
      `Remove ${p.name.trim() || (p.shirtStr ? `#${p.shirtStr}` : 'player')}?`,
      'The player is hidden from new lineup pickers but kept on the roster so prior matches still render their name. Use "Show inactive" to bring them back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => patchPlayer(rowId, { active: false }),
        },
      ]
    );
  }

  // Live duplicate-shirt detection across the active roster (inactive
  // players don't count — they can keep their old #).
  const activeShirtCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of players) {
      if (!p.active) continue;
      const n = parseInt(p.shirtStr, 10);
      if (!isFinite(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  }, [players]);

  function isDuplicateShirt(p: DraftPlayer): boolean {
    if (!p.active) return false;
    const n = parseInt(p.shirtStr, 10);
    if (!isFinite(n)) return false;
    return (activeShirtCounts.get(n) ?? 0) > 1;
  }

  function handleSave() {
    const errors: string[] = [];
    const seen = new Set<number>();
    const out: RosterPlayer[] = [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const trimmedShirt = p.shirtStr.trim();
      if (!trimmedShirt) {
        if (p.active) {
          errors.push(`Row ${i + 1}: shirt # is required.`);
        }
        // If inactive with empty shirt, just drop it — nothing to preserve.
        continue;
      }
      const n = parseInt(trimmedShirt, 10);
      if (!isFinite(n) || n < 0) {
        errors.push(`Row ${i + 1}: shirt # must be a non-negative number.`);
        continue;
      }
      if (p.active && seen.has(n)) {
        errors.push(`Shirt #${n} is used by more than one active player.`);
        continue;
      }
      if (p.active) seen.add(n);
      out.push({
        shirt: n,
        name: p.name.trim(),
        isLibero: p.isLibero,
        isCaptain: p.isCaptain || undefined,
        position: p.position,
        active: p.active,
        source: p.source,
      });
    }

    if (errors.length) {
      // Dedupe + cap so the alert stays short.
      const unique = Array.from(new Set(errors)).slice(0, 5);
      Alert.alert('Fix these before saving', unique.join('\n'));
      return;
    }

    onSave({ roster: out, rosterUpdatedAt: Date.now() });
  }

  const inactiveCount = players.filter((p) => !p.active).length;
  const activeCount = players.length - inactiveCount;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backBtn}>{'< Cancel'}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>ROSTER</Text>
        <TouchableOpacity
          onPress={handleSave}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.saveBtn}>Save</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.teamLabel} numberOfLines={1}>{team.label}</Text>
        <View style={styles.subHeaderRow}>
          <Text style={styles.countText}>
            {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
          </Text>
          {inactiveCount > 0 ? (
            <TouchableOpacity
              onPress={() => setShowInactive((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.toggleText}>
                {showInactive ? 'Hide inactive' : 'Show inactive'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {visiblePlayers.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No players yet</Text>
              <Text style={styles.emptyBody}>
                Add players here so they pre-fill when you score a match.
                Empty names are fine — players will show as "#14" etc.
              </Text>
            </View>
          ) : (
            visiblePlayers.map((p) => (
              <PlayerRow
                key={p.rowId}
                player={p}
                duplicateShirt={isDuplicateShirt(p)}
                onPatch={(patch) => patchPlayer(p.rowId, patch)}
                onLongPress={() => {
                  if (p.active) softDeletePlayer(p.rowId);
                }}
                styles={styles}
                colors={colors}
              />
            ))
          )}

          <TouchableOpacity
            style={styles.addBtn}
            onPress={addPlayer}
            activeOpacity={0.7}
          >
            <Text style={styles.addBtnText}>+ Add player</Text>
          </TouchableOpacity>

          <Text style={styles.footerHint}>
            Long-press a row to soft-delete (keeps historical references).
            Shirt #s must be unique within the active roster.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PlayerRow({
  player,
  duplicateShirt,
  onPatch,
  onLongPress,
  styles,
  colors,
}: {
  player: DraftPlayer;
  duplicateShirt: boolean;
  onPatch: (patch: Partial<DraftPlayer>) => void;
  onLongPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const inactive = !player.active;
  return (
    <TouchableOpacity
      activeOpacity={0.95}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={[styles.rowCard, inactive && styles.rowCardInactive]}
    >
      {inactive ? (
        <View style={styles.inactiveBadge}>
          <Text style={styles.inactiveBadgeText}>INACTIVE</Text>
        </View>
      ) : null}

      <View style={styles.rowTop}>
        <View style={styles.shirtField}>
          <Text style={styles.fieldLabel}>SHIRT</Text>
          <TextInput
            style={[
              styles.input,
              styles.shirtInput,
              duplicateShirt && styles.inputError,
            ]}
            value={player.shirtStr}
            onChangeText={(v) => onPatch({ shirtStr: v.replace(/[^0-9]/g, '').slice(0, 3) })}
            keyboardType="number-pad"
            placeholder="#"
            placeholderTextColor={colors.textLight}
            maxLength={3}
          />
        </View>
        <View style={styles.nameField}>
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            style={styles.input}
            value={player.name}
            onChangeText={(v) => onPatch({ name: v })}
            placeholder="Optional"
            placeholderTextColor={colors.textLight}
          />
        </View>
      </View>

      {duplicateShirt ? (
        <Text style={styles.errorText}>Shirt # is also used by another active player.</Text>
      ) : null}

      <View style={styles.rowMid}>
        <Text style={styles.fieldLabel}>POSITION</Text>
        <View style={styles.positionRow}>
          {POSITION_OPTIONS.map((opt) => {
            const active = (player.position ?? '') === opt;
            const label = opt === '' ? '—' : opt;
            return (
              <TouchableOpacity
                key={String(opt)}
                style={[styles.posPill, active && styles.posPillActive]}
                onPress={() => onPatch({ position: opt === '' ? undefined : opt })}
                activeOpacity={0.7}
              >
                <Text style={[styles.posPillText, active && styles.posPillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.rowBottom}>
        <ToggleChip
          label="Libero"
          active={player.isLibero}
          onPress={() => onPatch({ isLibero: !player.isLibero })}
          styles={styles}
        />
        <ToggleChip
          label="Captain"
          active={player.isCaptain}
          onPress={() => onPatch({ isCaptain: !player.isCaptain })}
          styles={styles}
        />
        <ToggleChip
          label="Active"
          active={player.active}
          onPress={() => onPatch({ active: !player.active })}
          styles={styles}
        />
      </View>
    </TouchableOpacity>
  );
}

function ToggleChip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[styles.toggleChip, active && styles.toggleChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.toggleChipText, active && styles.toggleChipTextActive]}>
        {active ? `✓ ${label}` : label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      // Right padding clears the absolute-positioned hamburger overlay
      // (App.tsx menuOverlay lives at right:8 and is ~56px wide). Same
      // 64px buffer used by MatchListScreen / ScoreboardScreen.
      paddingRight: 64,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '800',
      letterSpacing: 1,
    },
    saveBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '700' },
    subHeader: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.surface,
    },
    teamLabel: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    subHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    countText: { fontSize: fontSize.xs, color: colors.textSecondary },
    toggleText: {
      fontSize: fontSize.xs,
      color: colors.primary,
      fontWeight: '700',
    },
    body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.divider,
      marginBottom: spacing.md,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      marginBottom: 4,
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    rowCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    rowCardInactive: {
      opacity: 0.6,
      borderStyle: 'dashed',
    },
    inactiveBadge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.textLight,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      marginBottom: spacing.xs,
    },
    inactiveBadgeText: {
      color: colors.textOnPrimary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    rowTop: { flexDirection: 'row', gap: spacing.sm },
    shirtField: { width: 80 },
    nameField: { flex: 1 },
    fieldLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textLight,
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingVertical: 8,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.md,
      color: colors.text,
      backgroundColor: colors.background,
    },
    shirtInput: { textAlign: 'center', fontWeight: '700' },
    inputError: { borderColor: colors.error },
    errorText: {
      color: colors.error,
      fontSize: fontSize.xs,
      marginTop: 4,
    },
    rowMid: { marginTop: spacing.sm },
    positionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: 2,
    },
    posPill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minWidth: 36,
      alignItems: 'center',
    },
    posPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    posPillText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    posPillTextActive: { color: colors.textOnPrimary },
    rowBottom: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    toggleChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    toggleChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    toggleChipText: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    toggleChipTextActive: { color: '#ffffff' },
    addBtn: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      alignSelf: 'flex-start',
      marginTop: spacing.sm,
    },
    addBtnText: {
      color: colors.primary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    footerHint: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontStyle: 'italic',
      marginTop: spacing.lg,
      lineHeight: 16,
    },
  });
}
