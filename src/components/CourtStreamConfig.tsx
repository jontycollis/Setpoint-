import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import {
  loadCourtStreams,
  saveCourtStreams,
  CourtStreamMap,
} from '../utils/storage';

interface Props {
  visible: boolean;
  onClose: () => void;
  eventKey: string;
  courtNames: string[]; // List of court names from the schedule
}

export function CourtStreamConfig({
  visible,
  onClose,
  eventKey,
  courtNames,
}: Props) {
  const [streams, setStreams] = useState<CourtStreamMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      loadCourtStreams(eventKey).then((saved) => {
        setStreams(saved);
        setLoading(false);
      });
    }
  }, [visible, eventKey]);

  function isAllowedUrl(url: string): boolean {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.hostname.toLowerCase() === 'cbc.watch.pixellot.tv';
    } catch {
      return false;
    }
  }

  function updateStream(courtName: string, url: string) {
    setStreams((prev) => ({ ...prev, [courtName]: url }));
  }

  async function handleSave() {
    setSaving(true);
    // Validate and clean up entries
    const cleaned: CourtStreamMap = {};
    const invalid: string[] = [];
    for (const [court, url] of Object.entries(streams)) {
      const trimmed = url.trim();
      if (!trimmed) continue;
      if (isAllowedUrl(trimmed)) {
        cleaned[court] = trimmed;
      } else {
        invalid.push(court);
      }
    }
    if (invalid.length > 0) {
      setSaving(false);
      Alert.alert(
        'Invalid URLs',
        `The following courts have invalid URLs: ${invalid.join(', ')}.\n\nOnly links from cbc.watch.pixellot.tv are allowed.`
      );
      return;
    }
    await saveCourtStreams(eventKey, cleaned);
    setSaving(false);
    onClose();
  }

  function handleClearAll() {
    Alert.alert('Clear All', 'Remove all stream URLs for this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setStreams({});
          saveCourtStreams(eventKey, {});
        },
      },
    ]);
  }

  const configuredCount = Object.values(streams).filter(
    (v) => v && v.trim().length > 0
  ).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Live Stream Links</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            <Text style={styles.saveText}>
              {saving ? 'Saving...' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          Paste the stream URL from cbc.watch.pixellot.tv for each court.{' '}
          {configuredCount > 0
            ? `${configuredCount} of ${courtNames.length} configured.`
            : 'No streams configured yet.'}
        </Text>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView style={styles.list}>
            {courtNames.map((courtName) => (
              <View key={courtName} style={styles.courtRow}>
                <Text style={styles.courtLabel}>{courtName}</Text>
                <TextInput
                  style={[
                    styles.urlInput,
                    streams[courtName] ? styles.urlInputFilled : null,
                  ]}
                  value={streams[courtName] || ''}
                  onChangeText={(text) => updateStream(courtName, text)}
                  placeholder="Paste stream URL..."
                  placeholderTextColor={colors.textLight}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {streams[courtName] ? (
                  <TouchableOpacity
                    onPress={() => updateStream(courtName, '')}
                    style={styles.clearBtn}
                  >
                    <Text style={styles.clearBtnText}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleClearAll}
              >
                <Text style={styles.actionButtonTextDanger}>
                  Clear All Links
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  cancelText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  saveText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  courtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  courtLabel: {
    width: 90,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
  },
  urlInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  urlInputFilled: {
    borderColor: colors.primary,
    backgroundColor: '#f0f7ff',
  },
  clearBtn: {
    marginLeft: spacing.xs,
    padding: spacing.xs,
  },
  clearBtnText: {
    fontSize: fontSize.md,
    color: colors.textLight,
  },
  actions: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  actionButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  actionButtonTextDanger: {
    fontSize: fontSize.sm,
    color: colors.loss,
    fontWeight: '600',
  },
});
