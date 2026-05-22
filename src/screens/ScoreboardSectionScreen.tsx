// ── ScoreboardSectionScreen ───────────────────────────────────────────────
// Sub-tile landing for the Scoreboard launcher tile. Three sub-tiles:
//   • Simple (Tier 1)        — the hold-up scoreboard
//   • Advanced (Tier 2)      — match list / score-a-match flow
//   • Resume last match      — only enabled when there's a live in-progress
//                              scored match in AsyncStorage
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { loadMatches } from '../utils/scoredMatchStore';
import type { Match } from '../types/match';

interface Props {
  onBack: () => void;
  onOpenSimple: () => void;
  onOpenAdvanced: () => void;
  onResumeMatch: (match: Match) => void;
}

export function ScoreboardSectionScreen({
  onBack,
  onOpenSimple,
  onOpenAdvanced,
  onResumeMatch,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Find the most recently-updated in-progress match for the Resume tile.
  // Re-checks on screen mount only — the section is a thin chooser, not a
  // live dashboard, so a 30s tick is unnecessary here.
  const [resumable, setResumable] = useState<Match | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await loadMatches();
        const live = all
          .filter((m) => m.status === 'in-progress')
          .sort((a, b) => b.updatedAt - a.updatedAt);
        if (!cancelled) setResumable(live[0] ?? null);
      } catch {
        if (!cancelled) setResumable(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeHint =
    resumable === undefined
      ? 'Checking…'
      : resumable
        ? `${resumable.meta?.home?.label ?? 'Home'} vs ${resumable.meta?.away?.label ?? 'Away'}`
        : 'No live match to resume';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader
          title="Scoreboard"
          subtitle="Score a match."
          onBack={onBack}
        />
        <View style={styles.grid}>
          <View style={styles.row}>
            <LauncherTile
              glyph="📟"
              title="Simple"
              hint="Tier 1 — hold-up scoreboard"
              accent
              onPress={onOpenSimple}
              testID="sb-tile-simple"
            />
            <LauncherTile
              glyph="📊"
              title="Advanced"
              hint="Tier 2 — full match stats"
              onPress={onOpenAdvanced}
              testID="sb-tile-advanced"
            />
          </View>
          <View style={styles.row}>
            <LauncherTile
              glyph="▶️"
              title="Resume last match"
              hint={resumeHint}
              disabled={!resumable}
              onPress={() => {
                if (resumable) onResumeMatch(resumable);
              }}
              testID="sb-tile-resume"
            />
            <View style={styles.spacer} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: spacing.lg },
    grid: { gap: spacing.md, marginTop: spacing.md },
    row: { flexDirection: 'row', gap: spacing.md },
    spacer: { flex: 1 },
  });
}
