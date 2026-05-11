// ── HistoricalImportScreen ────────────────────────────────────────────────
//
// Settings → "Import historical matches". Lists the bundled Sideline HD
// imports (v1: just the PVC 3D Titanium 2025-26 season) and lets the user
// pull them into Tier-2 storage with one tap.
//
// The import is non-destructive and idempotent: existing match ids (the
// deterministic `import-pvc-<matchId>` form) are skipped on re-run, so
// the user can hit "Re-run import" safely if the bundle ever ships fresh
// records in a later app version.
// ──────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  getHistoricalImportBundle,
  findImportTargetTeam,
  runHistoricalImport,
  countImportedFromBundle,
  type HistoricalImportBundle,
  type HistoricalImportResult,
} from '../utils/historicalImporter';

interface Props {
  userProfile: UserProfile | null;
  onBack: () => void;
}

export function HistoricalImportScreen({ userProfile, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const bundle = useMemo<HistoricalImportBundle>(
    () => getHistoricalImportBundle(),
    []
  );
  const targetTeam = useMemo<TeamProfile | null>(
    () => findImportTargetTeam(userProfile, bundle),
    [userProfile, bundle]
  );

  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const n = await countImportedFromBundle(bundle);
      setImportedCount(n);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not read storage', msg);
    } finally {
      setLoading(false);
    }
  }, [bundle]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function showResult(result: HistoricalImportResult) {
    const lines: string[] = [
      `Imported ${result.imported} match${result.imported === 1 ? '' : 'es'}.`,
    ];
    if (result.skipped > 0) {
      lines.push(`Skipped ${result.skipped} (already in storage).`);
    }
    if (result.warnings.length > 0) {
      lines.push('');
      lines.push(
        `${result.warnings.length} warning${
          result.warnings.length === 1 ? '' : 's'
        }:`
      );
      // Cap displayed warnings — the alert can't scroll usefully past a
      // handful of lines.
      for (const w of result.warnings.slice(0, 5)) {
        lines.push(`  • ${w}`);
      }
      if (result.warnings.length > 5) {
        lines.push(`  …plus ${result.warnings.length - 5} more (see logs).`);
      }
    }
    Alert.alert('Import complete', lines.join('\n'));
  }

  async function doImport() {
    if (!targetTeam) return;
    setImporting(true);
    try {
      const result = await runHistoricalImport(bundle, targetTeam.id);
      await refresh();
      showResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Import failed', msg);
    } finally {
      setImporting(false);
    }
  }

  function confirmImport() {
    if (!targetTeam) return;
    const alreadyImported = importedCount > 0;
    const title = alreadyImported ? 'Re-run import?' : `Import ${bundle.matchCount} matches?`;
    const body = alreadyImported
      ? `${importedCount} of ${bundle.matchCount} already imported. Re-running is non-destructive — existing matches are skipped.`
      : `Import ${bundle.matchCount} matches from Sideline HD into your ${targetTeam.label} analytics? This is non-destructive — existing matches are skipped.`;
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: alreadyImported ? 'Re-run' : 'Import',
        onPress: doImport,
      },
    ]);
  }

  const fullyImported = importedCount >= bundle.matchCount && bundle.matchCount > 0;

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} colors={colors} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              Pull bundled Sideline HD season data into your Tier-2
              analytics. The import is non-destructive — matches you
              already have are skipped.
            </Text>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{bundle.label}</Text>
              <Text style={styles.cardMeta}>
                {bundle.matchCount} match{bundle.matchCount === 1 ? '' : 'es'}{' '}
                · target team: {bundle.targetTeamLabel}
              </Text>

              {!targetTeam ? (
                <View style={styles.warningBlock}>
                  <Text style={styles.warningTitle}>
                    Add this team first
                  </Text>
                  <Text style={styles.warningBody}>
                    Add &ldquo;{bundle.targetTeamLabel}&rdquo; as one of your
                    teams, then come back to import. The importer needs a
                    matching TeamProfile to attach these matches to.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.statusBlock}>
                    {fullyImported ? (
                      <Text style={styles.statusOk}>
                        ✓ Already imported — {importedCount} of{' '}
                        {bundle.matchCount} matches
                      </Text>
                    ) : importedCount > 0 ? (
                      <Text style={styles.statusPartial}>
                        Partial — {importedCount} of {bundle.matchCount}{' '}
                        already in storage
                      </Text>
                    ) : (
                      <Text style={styles.statusReady}>
                        Ready to import — will attach to {targetTeam.label}
                      </Text>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.cta,
                      importing && styles.ctaDisabled,
                    ]}
                    onPress={confirmImport}
                    disabled={importing}
                    activeOpacity={0.7}
                  >
                    {importing ? (
                      <ActivityIndicator color={colors.textOnPrimary} />
                    ) : (
                      <Text style={styles.ctaLabel}>
                        {fullyImported ? 'Re-run import' : 'Import'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Hero({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hero}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>SETTINGS</Text>
      <Text style={styles.heroTitle}>Import historical matches</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: {
      backgroundColor: colors.primary,
      padding: spacing.xxl,
      paddingBottom: spacing.lg,
    },
    heroBack: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: fontSize.md,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    heroKicker: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: 1,
    },
    heroTitle: {
      color: colors.textOnPrimary,
      fontSize: fontSize.xxl,
      fontWeight: '800',
    },
    scrollContent: {
      padding: spacing.lg,
    },
    centeredBlock: {
      paddingVertical: spacing.xxl,
      alignItems: 'center',
    },
    intro: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.lg,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    cardMeta: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.md,
    },
    statusBlock: {
      marginBottom: spacing.md,
    },
    statusOk: {
      fontSize: fontSize.sm,
      color: colors.success,
      fontWeight: '700',
    },
    statusPartial: {
      fontSize: fontSize.sm,
      color: colors.warning,
      fontWeight: '700',
    },
    statusReady: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
    },
    warningBlock: {
      marginTop: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.primaryLight,
      borderRadius: borderRadius.sm,
    },
    warningTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: spacing.xs,
    },
    warningBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
    },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    ctaDisabled: {
      opacity: 0.6,
    },
    ctaLabel: {
      color: colors.textOnPrimary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
  });
}
