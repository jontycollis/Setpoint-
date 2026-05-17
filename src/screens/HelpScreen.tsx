// ── HelpScreen ────────────────────────────────────────────────────────────
//
// In-app user guide. Renders HELP_SECTIONS (src/help/content.ts) as a
// collapsible accordion. Header row taps to expand / collapse. Optional
// `initialSectionId` opens a specific section pre-expanded (used by
// HelpButton from per-screen ? icons).
//
// A search box filters sections by title / summary / body text. When a
// match is found, all matching sections are auto-expanded so the user
// can see context immediately.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  LayoutChangeEvent,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  HELP_SECTIONS,
  type HelpBlock,
  type HelpSection,
  type HelpSectionId,
} from '../help/content';

interface Props {
  onBack: () => void;
  /** When provided, expands that section on mount and scrolls to it. */
  initialSectionId?: HelpSectionId | string;
}

export function HelpScreen({ onBack, initialSectionId }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Expanded sections — Set of ids. Initial section pre-expanded.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (initialSectionId) initial.add(initialSectionId);
    return initial;
  });

  const [query, setQuery] = useState('');

  // Filter pipeline. When a query is set, match section title / summary /
  // any block text. Matches auto-expand so the user sees context.
  const filtered: HelpSection[] = useMemo(() => {
    if (!query.trim()) return HELP_SECTIONS;
    const q = query.trim().toLowerCase();
    return HELP_SECTIONS.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.summary.toLowerCase().includes(q)) return true;
      return s.blocks.some((b) => b.text.toLowerCase().includes(q));
    });
  }, [query]);

  // Auto-expand all sections that survived the filter when a query exists.
  useEffect(() => {
    if (!query.trim()) return;
    setExpanded(new Set(filtered.map((s) => s.id)));
  }, [filtered, query]);

  // Scroll to the initial section once we know its y position.
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionYs = useRef<Record<string, number>>({});
  const didInitialScrollRef = useRef(false);

  function handleSectionLayout(id: string, e: LayoutChangeEvent) {
    sectionYs.current[id] = e.nativeEvent.layout.y;
    // Once we know the target's y, scroll to it (one time only).
    if (
      initialSectionId &&
      id === initialSectionId &&
      !didInitialScrollRef.current
    ) {
      didInitialScrollRef.current = true;
      // Small timeout so the layout settles before scrolling.
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, sectionYs.current[id] - 8),
          animated: true,
        });
      }, 60);
    }
  }

  function toggleSection(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.heroTitle}>Help & user guide</Text>
        <Text style={styles.heroSubtitle}>
          Tap any section to expand. Search across the whole guide below.
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search the help guide…"
          placeholderTextColor={colors.textLight}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search help"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => setQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clearBtnText}>{'✕'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={styles.emptyText}>
            No matches for “{query}”. Try a shorter query, or clear the
            search to browse all sections.
          </Text>
        ) : (
          filtered.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              expanded={expanded.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              onLayoutCard={(e) => handleSectionLayout(section.id, e)}
            />
          ))
        )}
        <Text style={styles.footerText}>
          Need more help? Hamburger → About & privacy → Contact.
        </Text>
      </ScrollView>
    </View>
  );
}

function SectionCard({
  section,
  expanded,
  onToggle,
  onLayoutCard,
}: {
  section: HelpSection;
  expanded: boolean;
  onToggle: () => void;
  onLayoutCard: (e: LayoutChangeEvent) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.card} onLayout={onLayoutCard}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{section.title}</Text>
          <Text style={styles.cardSummary} numberOfLines={2}>
            {section.summary}
          </Text>
        </View>
        <Text style={styles.cardChevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.cardBody}>
          {section.blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BlockRenderer({ block }: { block: HelpBlock }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  switch (block.type) {
    case 'h3':
      return <Text style={styles.h3}>{block.text}</Text>;
    case 'p':
      return <Text style={styles.p}>{block.text}</Text>;
    case 'li':
      return (
        <View style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{block.text}</Text>
        </View>
      );
    case 'tip':
      return (
        <View style={styles.tipCard}>
          <Text style={styles.tipLabel}>TIP</Text>
          <Text style={styles.tipText}>{block.text}</Text>
        </View>
      );
    case 'note':
      return (
        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>NOTE</Text>
          <Text style={styles.noteText}>{block.text}</Text>
        </View>
      );
  }
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    hero: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      paddingTop: spacing.xxl,
    },
    heroBack: {
      color: '#fff',
      fontSize: fontSize.md,
      fontWeight: '600',
      marginBottom: spacing.xs,
    },
    heroTitle: {
      color: '#fff',
      fontSize: fontSize.xxl,
      fontWeight: '700',
      marginTop: 2,
    },
    heroSubtitle: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: fontSize.sm,
      marginTop: 4,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    searchInput: {
      flex: 1,
      backgroundColor: colors.background,
      borderColor: colors.divider,
      borderWidth: 1,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      fontSize: fontSize.md,
      color: colors.text,
    },
    clearBtn: {
      marginLeft: spacing.sm,
      padding: spacing.xs,
    },
    clearBtnText: {
      fontSize: 16,
      color: colors.textLight,
      fontWeight: '700',
    },
    body: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl * 2,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      fontStyle: 'italic',
      textAlign: 'center',
      marginTop: spacing.xl,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    cardHeaderText: {
      flex: 1,
    },
    cardTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    cardSummary: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    cardChevron: {
      fontSize: 14,
      color: colors.textLight,
      marginLeft: spacing.md,
    },
    cardBody: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    h3: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    p: {
      fontSize: fontSize.md,
      color: colors.text,
      lineHeight: 21,
      marginBottom: spacing.sm,
    },
    bulletRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: spacing.xs,
    },
    bulletDot: {
      fontSize: fontSize.md,
      color: colors.primary,
      marginRight: spacing.sm,
      lineHeight: 21,
    },
    bulletText: {
      flex: 1,
      fontSize: fontSize.md,
      color: colors.text,
      lineHeight: 21,
    },
    tipCard: {
      backgroundColor: colors.primaryLight,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.sm,
    },
    tipLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.primary,
      marginBottom: 4,
    },
    tipText: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
    },
    noteCard: {
      backgroundColor: colors.background,
      borderLeftWidth: 3,
      borderLeftColor: colors.textLight,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.sm,
    },
    noteLabel: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.textLight,
      marginBottom: 4,
    },
    noteText: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    footerText: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      textAlign: 'center',
      marginTop: spacing.xl,
      fontStyle: 'italic',
    },
  });
}
