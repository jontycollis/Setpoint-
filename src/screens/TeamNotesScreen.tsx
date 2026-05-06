import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { loadTeamNotes, saveTeamNote, deleteTeamNote } from '../utils/storage';
import type { TeamNote } from '../utils/storage';

interface Props {
  eventKey: string;
  teamId: number;
  teamName: string;
  onBack: () => void;
}

export function TeamNotesScreen({ eventKey, teamId, teamName, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [notes, setNotes] = useState<TeamNote[]>([]);
  const [newText, setNewText] = useState('');
  const [author, setAuthor] = useState('');

  const refresh = useCallback(async () => {
    const loaded = await loadTeamNotes(eventKey, teamId);
    setNotes(loaded);
  }, [eventKey, teamId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async () => {
    const text = newText.trim();
    if (!text) return;
    const note: TeamNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      timestamp: Date.now(),
      author: author.trim() || undefined,
    };
    await saveTeamNote(eventKey, teamId, note);
    setNewText('');
    refresh();
  };

  const handleDelete = (noteId: string) => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTeamNote(eventKey, teamId, noteId);
          refresh();
        },
      },
    ]);
  };

  function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - ts;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
            <Text style={styles.backText}>{'< Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Team Notes</Text>
          <Text style={styles.subtitle}>{teamName}</Text>
        </View>

        {/* Notes list */}
        <ScrollView style={styles.notesList} contentContainerStyle={styles.notesContent}>
          {notes.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>{'\u{1F4DD}'}</Text>
              <Text style={styles.emptyTitle}>No notes yet</Text>
              <Text style={styles.emptyText}>
                Add notes for game plans, lineup changes, warmup times, or anything your team needs to coordinate.
              </Text>
            </View>
          )}
          {notes.map((note) => (
            <View key={note.id} style={styles.noteCard}>
              <View style={styles.noteHeader}>
                {note.author ? (
                  <Text style={styles.noteAuthor}>{note.author}</Text>
                ) : (
                  <Text style={styles.noteAuthorAnon}>Note</Text>
                )}
                <Text style={styles.noteTime}>{formatTimestamp(note.timestamp)}</Text>
              </View>
              <Text style={styles.noteText}>{note.text}</Text>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(note.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        {/* Input area */}
        <View style={styles.inputArea}>
          <TextInput
            style={styles.authorInput}
            value={author}
            onChangeText={setAuthor}
            placeholder="Your name (optional)"
            placeholderTextColor={colors.textLight}
          />
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={newText}
              onChangeText={setNewText}
              placeholder="Add a note..."
              placeholderTextColor={colors.textLight}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !newText.trim() && styles.sendBtnDisabled]}
              onPress={handleAdd}
              disabled={!newText.trim()}
            >
              <Text style={styles.sendBtnText}>{'\u{2191}'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  backText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  notesList: {
    flex: 1,
  },
  notesContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: spacing.xl,
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  noteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  noteAuthor: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
  },
  noteAuthorAnon: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textLight,
  },
  noteTime: {
    fontSize: fontSize.xs,
    color: colors.textLight,
  },
  noteText: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 22,
  },
  deleteBtn: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
  },
  deleteBtnText: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: '600',
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  authorInput: {
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 100,
    marginRight: spacing.sm,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.textLight,
  },
  sendBtnText: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: '#ffffff',
  },
});
}
