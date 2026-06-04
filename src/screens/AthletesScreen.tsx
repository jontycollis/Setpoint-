// ── AthletesScreen ─────────────────────────────────────────────────────────
//
// Multi-athlete management surface. Reads `userProfile.athletes[]` and
// `activeAthleteId`, lets the account holder add, rename, remove, and
// switch between athletes. Reached from the hamburger menu under "Manage
// athletes". Watching teams stay account-holder-scoped (no per-athlete
// association), so this screen only governs the me-team athlete the
// Career rollups attach to.
//
// Edge case: deleting an athlete with attached me-teams. We re-parent
// those teams to whichever athlete remains active (or the first
// remaining athlete) so they don't become orphaned. If the deleted
// athlete is the only one, the user gets a "create a new athlete to
// delete this one" guard — there has to be at least one athlete to
// host the me-teams.
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
  Modal,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { AthleteProfile, UserProfile } from '../types/profile';

interface Props {
  userProfile: UserProfile;
  onBack: () => void;
  /** Set the active athlete. Parent persists. */
  onSetActiveAthlete: (athleteId: string) => void;
  /** Add a new athlete. Parent generates the id, persists, returns it
   *  in case callers want to navigate or activate. */
  onAddAthlete: (params: {
    displayName: string;
    relation: AthleteProfile['relation'];
  }) => void;
  /** Rename an athlete's display label. */
  onRenameAthlete: (athleteId: string, displayName: string) => void;
  /**
   * Remove an athlete. The parent re-parents any me-teams that pointed
   * at this athlete onto the new active athlete (or whichever remains).
   */
  onRemoveAthlete: (athleteId: string) => void;
}

type EditMode =
  | { kind: 'closed' }
  | { kind: 'adding' }
  | { kind: 'renaming'; athleteId: string; currentName: string };

export function AthletesScreen({
  userProfile,
  onBack,
  onSetActiveAthlete,
  onAddAthlete,
  onRenameAthlete,
  onRemoveAthlete,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const athletes = userProfile.athletes;
  const activeId = userProfile.activeAthleteId;

  const [editMode, setEditMode] = useState<EditMode>({ kind: 'closed' });
  const [pendingName, setPendingName] = useState('');
  const [pendingRelation, setPendingRelation] =
    useState<AthleteProfile['relation']>('child');

  const handleStartAdd = () => {
    setPendingName('');
    setPendingRelation('child');
    setEditMode({ kind: 'adding' });
  };
  const handleStartRename = (athlete: AthleteProfile) => {
    setPendingName(athlete.displayName);
    setEditMode({ kind: 'renaming', athleteId: athlete.id, currentName: athlete.displayName });
  };
  const handleCancelEdit = () => {
    setEditMode({ kind: 'closed' });
    setPendingName('');
  };
  const handleSaveEdit = () => {
    const trimmed = pendingName.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a name for the athlete.');
      return;
    }
    if (editMode.kind === 'adding') {
      onAddAthlete({ displayName: trimmed, relation: pendingRelation });
    } else if (editMode.kind === 'renaming') {
      onRenameAthlete(editMode.athleteId, trimmed);
    }
    handleCancelEdit();
  };

  const handleRemove = (athlete: AthleteProfile) => {
    if (athletes.length === 1) {
      Alert.alert(
        "Can't remove the only athlete",
        'Add another athlete first — your teams need at least one athlete to belong to.'
      );
      return;
    }
    Alert.alert(
      `Remove ${athlete.displayName}?`,
      "Their teams will move to whichever athlete is active. You can move them again later from each team's menu.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => onRemoveAthlete(athlete.id),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backLabel}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Athletes</Text>
      <Text style={styles.subtitle}>
        Each athlete owns their own set of teams. The active athlete
        scopes MyHome to that person's teams; watching favorites are
        shared across athletes.
      </Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {athletes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No athletes yet</Text>
            <Text style={styles.emptyBody}>
              Tap "Add athlete" below to start tracking teams for your
              child, yourself, or anyone else whose volleyball season
              you follow.
            </Text>
          </View>
        ) : (
          athletes.map((athlete) => {
            const isActive = athlete.id === activeId;
            const teamCount = userProfile.teams.filter(
              (t) => t.kind === 'me' && t.athleteId === athlete.id
            ).length;
            return (
              <View
                key={athlete.id}
                style={[styles.row, isActive && styles.rowActive]}
              >
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => onSetActiveAthlete(athlete.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>
                      {athlete.displayName}
                      {isActive ? '  ✓' : ''}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {athleteRelationLabel(athlete.relation)} ·{' '}
                      {teamCount === 1 ? '1 team' : `${teamCount} teams`}
                    </Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    onPress={() => handleStartRename(athlete)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.rowAction}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRemove(athlete)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.rowActionDestructive}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleStartAdd}
          activeOpacity={0.7}
        >
          <Text style={styles.addBtnLabel}>+ Add athlete</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={editMode.kind !== 'closed'}
        transparent
        animationType="fade"
        onRequestClose={handleCancelEdit}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={handleCancelEdit}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.modalTitle}>
              {editMode.kind === 'adding' ? 'Add athlete' : 'Rename athlete'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={pendingName}
              onChangeText={setPendingName}
              placeholder="Display name (e.g. Sarah)"
              placeholderTextColor={colors.textLight}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSaveEdit}
            />
            {editMode.kind === 'adding' ? (
              <View style={styles.relationRow}>
                {(['self', 'child', 'other'] as const).map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.relationChip,
                      pendingRelation === r && styles.relationChipActive,
                    ]}
                    onPress={() => setPendingRelation(r)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.relationChipLabel,
                        pendingRelation === r && styles.relationChipLabelActive,
                      ]}
                    >
                      {athleteRelationLabel(r)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                onPress={handleCancelEdit}
                style={[styles.modalBtn, styles.modalBtnCancel]}
                activeOpacity={0.7}
              >
                <Text style={styles.modalBtnCancelLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveEdit}
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                activeOpacity={0.7}
              >
                <Text style={styles.modalBtnConfirmLabel}>
                  {editMode.kind === 'adding' ? 'Add' : 'Rename'}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function athleteRelationLabel(rel: AthleteProfile['relation']): string {
  if (rel === 'self') return 'Me';
  if (rel === 'child') return 'Child';
  return 'Other';
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    backBtn: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    backLabel: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    title: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.text,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
      lineHeight: 20,
    },
    scroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    emptyBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    rowActive: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    rowMain: {
      flex: 1,
    },
    rowText: {
      flex: 1,
    },
    rowName: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    rowMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    rowActions: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingLeft: spacing.sm,
    },
    rowAction: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    rowActionDestructive: {
      fontSize: fontSize.sm,
      color: '#c0392b',
      fontWeight: '600',
    },
    addBtn: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    addBtnLabel: {
      color: '#ffffff',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      backgroundColor: '#ffffff',
      borderRadius: borderRadius.md,
      padding: spacing.lg,
    },
    modalTitle: {
      fontSize: fontSize.md,
      fontWeight: '800',
      color: '#1a1a1a',
      marginBottom: spacing.md,
    },
    modalInput: {
      borderWidth: 1,
      borderColor: '#d0d0d0',
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      fontSize: fontSize.md,
      color: '#1a1a1a',
      marginBottom: spacing.md,
    },
    relationRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    relationChip: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: '#d0d0d0',
      alignItems: 'center',
    },
    relationChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    relationChipLabel: {
      fontSize: fontSize.sm,
      color: '#666',
      fontWeight: '600',
    },
    relationChipLabelActive: {
      color: '#ffffff',
    },
    modalBtnRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    modalBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.sm,
    },
    modalBtnCancel: {
      backgroundColor: '#f1f1f1',
    },
    modalBtnCancelLabel: {
      color: '#444',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    modalBtnConfirm: {
      backgroundColor: colors.primary,
    },
    modalBtnConfirmLabel: {
      color: '#ffffff',
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
  });
}
