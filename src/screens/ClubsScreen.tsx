// ── ClubsScreen ────────────────────────────────────────────────────────────
//
// Manage the local Club entity. Each team in the user's profile can be
// assigned to at most one club; clubs group teams across sports + age
// groups (indoor + beach, U16 + U18, etc.) so the user can see "all PVC
// teams" / "all my child's teams at this club" without filtering by
// label every time.
//
// Migration auto-detects clubs from team-label prefixes on first load
// (see clubDetection.ts). This screen lets the user rename / merge /
// remove the auto-detected clubs and assign teams that were missed
// (beach pairs, standalones).
//
// Reached from the hamburger menu under "Manage clubs". Wireframe:
//
//   [← Back]  Clubs
//   Group your teams across sports and age groups. Auto-detected from
//   team names; rename or merge anytime.
//
//   [Card per club]
//     PVC ✓
//     3 teams (1 indoor, 2 beach)        Rename | Remove
//
//   + Add club
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
import type { Club, TeamProfile, UserProfile } from '../types/profile';

interface Props {
  userProfile: UserProfile;
  onBack: () => void;
  /** Create a new (empty) club. Parent generates the id + persists. */
  onAddClub: (params: { name: string }) => void;
  /** Rename a club's display label. */
  onRenameClub: (clubId: string, name: string) => void;
  /**
   * Remove a club. Parent un-stamps `clubId` from every team that
   * referenced it (teams aren't deleted, they just go back to being
   * unaffiliated until reassigned).
   */
  onRemoveClub: (clubId: string) => void;
  /**
   * Open the per-club team assignment editor. Pass undefined to open
   * a "no club yet" picker for a team. Implementation lives in a follow-up
   * pass; for now we just bring up the team list inline.
   */
  onAssignTeamsToClub?: (clubId: string | null) => void;
}

type EditMode =
  | { kind: 'closed' }
  | { kind: 'adding' }
  | { kind: 'renaming'; clubId: string; currentName: string };

export function ClubsScreen({
  userProfile,
  onBack,
  onAddClub,
  onRenameClub,
  onRemoveClub,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const clubs = userProfile.clubs;
  const teams = userProfile.teams;

  const [editMode, setEditMode] = useState<EditMode>({ kind: 'closed' });
  const [pendingName, setPendingName] = useState('');

  const handleStartAdd = () => {
    setPendingName('');
    setEditMode({ kind: 'adding' });
  };
  const handleStartRename = (club: Club) => {
    setPendingName(club.name);
    setEditMode({ kind: 'renaming', clubId: club.id, currentName: club.name });
  };
  const handleCancelEdit = () => {
    setEditMode({ kind: 'closed' });
    setPendingName('');
  };
  const handleSaveEdit = () => {
    const trimmed = pendingName.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a name for the club.');
      return;
    }
    if (editMode.kind === 'adding') {
      onAddClub({ name: trimmed });
    } else if (editMode.kind === 'renaming') {
      onRenameClub(editMode.clubId, trimmed);
    }
    handleCancelEdit();
  };

  const handleRemove = (club: Club) => {
    const teamCount = teams.filter((t) => t.clubId === club.id).length;
    const teamsBlurb =
      teamCount === 0
        ? "No teams are attached, so nothing else changes."
        : teamCount === 1
          ? "1 team will become unaffiliated. You can assign it to another club later."
          : `${teamCount} teams will become unaffiliated. You can assign them to other clubs later.`;
    Alert.alert(`Remove ${club.name}?`, teamsBlurb, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onRemoveClub(club.id),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backLabel}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Clubs</Text>
      <Text style={styles.subtitle}>
        Group your teams across sports and age groups. Auto-detected from
        team names; rename or merge anytime.
      </Text>

      <ScrollView contentContainerStyle={styles.scroll}>
        {clubs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No clubs yet</Text>
            <Text style={styles.emptyBody}>
              Tap "Add club" to create one and start grouping your teams.
            </Text>
          </View>
        ) : (
          clubs.map((club) => {
            const clubTeams = teams.filter((t) => t.clubId === club.id);
            return (
              <View key={club.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName}>{club.name}</Text>
                  <Text style={styles.rowMeta}>{clubTeamsLabel(clubTeams)}</Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    onPress={() => handleStartRename(club)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.rowAction}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRemove(club)}
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
          <Text style={styles.addBtnLabel}>+ Add club</Text>
        </TouchableOpacity>

        {unaffiliatedTeamsLabel(teams) ? (
          <Text style={styles.footnote}>{unaffiliatedTeamsLabel(teams)}</Text>
        ) : null}
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
              {editMode.kind === 'adding' ? 'Add club' : 'Rename club'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={pendingName}
              onChangeText={setPendingName}
              placeholder="Club name (e.g. PVC)"
              placeholderTextColor={colors.textLight}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSaveEdit}
            />
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

function clubTeamsLabel(teams: TeamProfile[]): string {
  if (teams.length === 0) return 'No teams yet — assign from a team\'s menu';
  const indoor = teams.filter((t) => t.sport === 'indoor').length;
  const beach = teams.filter((t) => t.sport === 'beach').length;
  const parts: string[] = [];
  if (indoor > 0) parts.push(`${indoor} indoor`);
  if (beach > 0) parts.push(`${beach} beach`);
  const detail = parts.join(' · ');
  const total = teams.length === 1 ? '1 team' : `${teams.length} teams`;
  return detail ? `${total} (${detail})` : total;
}

function unaffiliatedTeamsLabel(teams: TeamProfile[]): string | null {
  const unaffiliated = teams.filter((t) => !t.clubId);
  if (unaffiliated.length === 0) return null;
  if (unaffiliated.length === 1) {
    return '1 team isn\'t in a club yet. Open it and tap "Move to club" to assign.';
  }
  return `${unaffiliated.length} teams aren't in a club yet. Open one and tap "Move to club" to assign.`;
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
    rowMain: {
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
    footnote: {
      marginTop: spacing.md,
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      lineHeight: 18,
      paddingHorizontal: spacing.xs,
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
