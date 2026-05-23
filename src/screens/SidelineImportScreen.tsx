// ── SidelineImportScreen ──────────────────────────────────────────────────
//
// Self-serve import flow for ANY user's Sideline HD historical match data.
// Distinct from `HistoricalImportScreen`, which only pulls the bundled
// PVC 3D Titanium static export. This screen drives the full pipeline:
//
//   stage="check"        — feature flag + session sniff
//   stage="login"        — WebView pointed at sidelinehd.com/login;
//                          we watch URL changes for the post-login redirect
//                          and read the cookie jar.
//   stage="logged-in"    — confirmed session, button to fetch teams
//   stage="teams-load"   — calling the API for team list
//   stage="teams-list"   — pick which team to import
//   stage="teams-error"  — endpoint probe failed; show diagnostics
//   stage="matches-load" — calling the API for match list
//   stage="matches-list" — pick which matches to import (default all)
//   stage="matches-err"  — endpoint probe failed; show diagnostics
//   stage="importing"    — walking the selected list with progress
//   stage="done"         — summary card + back to caller
//
// Native dep `@react-native-cookies/cookies` is required for cookie
// capture. We feature-flag the entry point on
// `isSidelineHdCookieModuleAvailable()` so an OTA push to devices
// running an older APK shows an "Available in next app version" notice
// instead of crashing the screen.
// ──────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  WebViewNavigation,
  WebViewMessageEvent,
} from 'react-native-webview';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  SIDELINE_HD_LOGIN_URL,
  isSidelineHdCookieModuleAvailable,
  getSidelineHdCookieModuleLoadError,
  readSidelineHdCookies,
  looksLikeAuthenticatedSession,
  clearSidelineHdCookies,
  type CookieMap,
} from '../utils/sidelineHdCookies';
import {
  loadSidelineHdSession,
  saveSidelineHdSession,
  clearSidelineHdSession,
  type SidelineHdSessionRecord,
} from '../utils/sidelineHdSession';
import {
  fetchMyTeams,
  fetchTeamMatches,
  resetDiscoveredEndpoints,
  type SidelineHdMatchSummary,
  type SidelineHdProbeAttempt,
  type SidelineHdTeam,
} from '../api/sidelineHd';
import { findTeamProfileByAlias } from '../utils/userProfile';
import {
  runSidelineLiveImport,
  type SidelineLiveImportProgress,
  type SidelineLiveImportResult,
} from '../utils/sidelineHdLiveImporter';

interface Props {
  userProfile: UserProfile | null;
  onBack: () => void;
}

type Stage =
  | { kind: 'check' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'logged-out' }
  | { kind: 'login' }
  | { kind: 'logged-in'; session: SidelineHdSessionRecord }
  | { kind: 'teams-load' }
  | { kind: 'teams-list'; teams: SidelineHdTeam[] }
  | { kind: 'teams-error'; attempts: SidelineHdProbeAttempt[]; reason: string }
  | {
      kind: 'matches-load';
      team: SidelineHdTeam;
      teamProfile: TeamProfile | null;
    }
  | {
      kind: 'matches-list';
      team: SidelineHdTeam;
      teamProfile: TeamProfile | null;
      matches: SidelineHdMatchSummary[];
      selected: Record<string, boolean>;
    }
  | {
      kind: 'matches-error';
      team: SidelineHdTeam;
      attempts: SidelineHdProbeAttempt[];
      reason: string;
    }
  | {
      kind: 'importing';
      team: SidelineHdTeam;
      progress: SidelineLiveImportProgress | null;
    }
  | {
      kind: 'done';
      team: SidelineHdTeam;
      teamProfile: TeamProfile | null;
      result: SidelineLiveImportResult;
    };

export function SidelineImportScreen({ userProfile, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stage, setStage] = useState<Stage>({ kind: 'check' });
  const webViewRef = useRef<WebView>(null);
  // Holds the most-recent URL the WebView navigated to — used by the
  // dashboard sniff to decide if login is done. Stored in a ref because
  // we read it from async callbacks where stale closure state would lie.
  const lastUrlRef = useRef<string>(SIDELINE_HD_LOGIN_URL);

  // ── Initial probe ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSidelineHdCookieModuleAvailable()) {
        const detail =
          getSidelineHdCookieModuleLoadError() ??
          'Native cookie module not present in this build.';
        if (!cancelled) setStage({ kind: 'unavailable', reason: detail });
        return;
      }
      const stored = await loadSidelineHdSession();
      if (cancelled) return;
      if (stored) {
        setStage({ kind: 'logged-in', session: stored });
      } else {
        setStage({ kind: 'logged-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Login WebView navigation listener ────────────────────────────────
  const handleNavigationStateChange = useCallback(
    async (navState: WebViewNavigation) => {
      const url = navState.url;
      lastUrlRef.current = url;
      const stillOnLoginPage = /\/login(\?|$|\/)/.test(url);
      if (stillOnLoginPage) return;
      const cookies: CookieMap | null = await readSidelineHdCookies();
      if (!cookies) return;
      if (!looksLikeAuthenticatedSession(cookies)) return;
      const record: SidelineHdSessionRecord = {
        loggedInAtMs: Date.now(),
        cookieNames: Object.keys(cookies),
      };
      await saveSidelineHdSession(record);
      setStage({ kind: 'logged-in', session: record });
    },
    []
  );

  const handleStartLogin = useCallback(() => {
    setStage({ kind: 'login' });
  }, []);

  const handleLogout = useCallback(async () => {
    await clearSidelineHdCookies();
    await clearSidelineHdSession();
    resetDiscoveredEndpoints();
    setStage({ kind: 'logged-out' });
  }, []);

  const handleLoadTeams = useCallback(async () => {
    setStage({ kind: 'teams-load' });
    const res = await fetchMyTeams();
    if (!res.ok) {
      setStage({
        kind: 'teams-error',
        attempts: res.attempts,
        reason: res.reason,
      });
      return;
    }
    setStage({ kind: 'teams-list', teams: res.data });
  }, []);

  const handlePickTeam = useCallback(
    async (team: SidelineHdTeam) => {
      const teamProfile = findTeamProfileByAlias(userProfile, team.name);
      setStage({ kind: 'matches-load', team, teamProfile });
      const res = await fetchTeamMatches(team.id);
      if (!res.ok) {
        setStage({
          kind: 'matches-error',
          team,
          attempts: res.attempts,
          reason: res.reason,
        });
        return;
      }
      const selected: Record<string, boolean> = {};
      for (const m of res.data) selected[m.id] = true;
      setStage({
        kind: 'matches-list',
        team,
        teamProfile,
        matches: res.data,
        selected,
      });
    },
    [userProfile]
  );

  const handleToggleMatch = useCallback((matchId: string) => {
    setStage((prev) => {
      if (prev.kind !== 'matches-list') return prev;
      return {
        ...prev,
        selected: { ...prev.selected, [matchId]: !prev.selected[matchId] },
      };
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setStage((prev) => {
      if (prev.kind !== 'matches-list') return prev;
      const anyUnselected = prev.matches.some((m) => !prev.selected[m.id]);
      const next: Record<string, boolean> = {};
      for (const m of prev.matches) next[m.id] = anyUnselected;
      return { ...prev, selected: next };
    });
  }, []);

  const handleRunImport = useCallback(async () => {
    setStage((prev) => {
      if (prev.kind !== 'matches-list') return prev;
      const { team, teamProfile, matches, selected } = prev;
      const chosen = matches.filter((m) => selected[m.id]);
      if (chosen.length === 0) {
        Alert.alert('Nothing selected', 'Pick at least one match to import.');
        return prev;
      }
      if (!teamProfile) {
        Alert.alert(
          'Add this team first',
          `Add "${team.name}" as one of your teams in My Team, then come back to import.`
        );
        return prev;
      }
      // Kick off the async import after returning the in-flight stage.
      void (async () => {
        const result = await runSidelineLiveImport({
          team,
          teamProfileId: teamProfile.id,
          selectedMatches: chosen,
          onProgress: (progress) =>
            setStage({ kind: 'importing', team, progress }),
        });
        setStage({ kind: 'done', team, teamProfile, result });
      })();
      return { kind: 'importing', team, progress: null };
    });
  }, []);

  const handleBackToTeams = useCallback(() => {
    setStage({ kind: 'teams-load' });
    // Re-fetch in the next tick so the loading spinner shows.
    setTimeout(() => {
      void handleLoadTeams();
    }, 0);
  }, [handleLoadTeams]);

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} colors={colors} />
      {stage.kind === 'login' ? (
        <View style={styles.webviewWrap}>
          <WebView
            ref={webViewRef}
            source={{ uri: SIDELINE_HD_LOGIN_URL }}
            onNavigationStateChange={handleNavigationStateChange}
            onMessage={(_e: WebViewMessageEvent) => {
              // No-op — login page doesn't postMessage. Keeping the prop
              // around makes injecting diagnostics later trivial.
            }}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webviewLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
            userAgent={
              'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            }
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
          <View style={styles.webviewFooter}>
            <Text style={styles.webviewFooterText}>
              Log in above. We&apos;ll detect when you reach the dashboard.
            </Text>
            <TouchableOpacity
              onPress={() => setStage({ kind: 'logged-out' })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.webviewFooterLink}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <StageBody
            stage={stage}
            onStartLogin={handleStartLogin}
            onLogout={handleLogout}
            onLoadTeams={handleLoadTeams}
            onPickTeam={handlePickTeam}
            onToggleMatch={handleToggleMatch}
            onToggleAll={handleToggleAll}
            onRunImport={handleRunImport}
            onBackToTeams={handleBackToTeams}
            onDone={onBack}
            colors={colors}
          />
        </ScrollView>
      )}
    </View>
  );
}

function StageBody({
  stage,
  onStartLogin,
  onLogout,
  onLoadTeams,
  onPickTeam,
  onToggleMatch,
  onToggleAll,
  onRunImport,
  onBackToTeams,
  onDone,
  colors,
}: {
  stage: Stage;
  onStartLogin: () => void;
  onLogout: () => void;
  onLoadTeams: () => void;
  onPickTeam: (team: SidelineHdTeam) => void;
  onToggleMatch: (matchId: string) => void;
  onToggleAll: () => void;
  onRunImport: () => void;
  onBackToTeams: () => void;
  onDone: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (stage.kind === 'check') {
    return (
      <View style={styles.centeredBlock}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (stage.kind === 'unavailable') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Available in next app version</Text>
        <Text style={styles.cardBody}>
          This feature needs native modules that ship with the next APK
          build. Your app will get them automatically on the next store
          update — no action needed.
        </Text>
        {__DEV__ ? (
          <Text style={styles.cardDebug}>Debug: {stage.reason}</Text>
        ) : null}
      </View>
    );
  }
  if (stage.kind === 'logged-out') {
    return (
      <>
        <Text style={styles.intro}>
          Pull your historical match data from Sideline HD into Bior. Log
          in below — your session stays on this device.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connect Sideline HD</Text>
          <Text style={styles.cardBody}>
            We&apos;ll open the Sideline HD login page in a secure
            window. Once you&apos;re in, we&apos;ll list your teams and
            you can pick which one to import.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={onStartLogin}
            activeOpacity={0.7}
          >
            <Text style={styles.ctaLabel}>Log in to Sideline HD</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }
  if (stage.kind === 'logged-in') {
    return (
      <>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{'✓'} Connected to Sideline HD</Text>
          <Text style={styles.cardMeta}>
            Logged in{' '}
            {new Date(stage.session.loggedInAtMs).toLocaleString()}
          </Text>
          <Text style={styles.cardBody}>
            Tap below to pull your teams. We&apos;ll list them and you can
            pick which one to import.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={onLoadTeams}
            activeOpacity={0.7}
          >
            <Text style={styles.ctaLabel}>Load my teams</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={onLogout}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryCtaLabel}>Log out</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }
  if (stage.kind === 'teams-load') {
    return (
      <View style={styles.centeredBlock}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingLabel}>Fetching your teams…</Text>
      </View>
    );
  }
  if (stage.kind === 'teams-error') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Couldn&apos;t reach Sideline HD</Text>
        <Text style={styles.cardBody}>
          We tried a few endpoints but none returned a usable response.
          Your session may have expired — try logging out and back in. If
          this keeps happening, share the diagnostic below with support.
        </Text>
        <Text style={styles.diagnosticHeader}>What we tried:</Text>
        {stage.attempts.map((a, i) => (
          <Text key={`${a.url}-${i}`} style={styles.diagnosticLine}>
            • {a.url} — {String(a.status)}
            {a.contentTypeHint ? ` (${a.contentTypeHint})` : ''}
          </Text>
        ))}
        <TouchableOpacity
          style={styles.cta}
          onPress={onLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaLabel}>Log out and try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (stage.kind === 'teams-list') {
    if (stage.teams.length === 0) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No teams found</Text>
          <Text style={styles.cardBody}>
            We connected to Sideline HD but didn&apos;t see any teams on
            your account. If you expect to see teams here, make sure
            you&apos;re logged in as the right user on Sideline HD.
          </Text>
        </View>
      );
    }
    return (
      <>
        <Text style={styles.intro}>
          Pick a team to import. We&apos;ll show you the match list next
          and let you choose which ones to pull.
        </Text>
        {stage.teams.map((team) => (
          <TouchableOpacity
            key={team.id}
            style={styles.listRow}
            onPress={() => onPickTeam(team)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.listRowTitle}>{team.name}</Text>
              {team.league ? (
                <Text style={styles.listRowMeta}>{team.league}</Text>
              ) : null}
            </View>
            <Text style={styles.chev}>{'>'}</Text>
          </TouchableOpacity>
        ))}
      </>
    );
  }
  if (stage.kind === 'matches-load') {
    return (
      <View style={styles.centeredBlock}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingLabel}>
          Fetching matches for {stage.team.name}…
        </Text>
      </View>
    );
  }
  if (stage.kind === 'matches-error') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Couldn&apos;t fetch matches for {stage.team.name}
        </Text>
        <Text style={styles.cardBody}>{stage.reason}</Text>
        <Text style={styles.diagnosticHeader}>What we tried:</Text>
        {stage.attempts.map((a, i) => (
          <Text key={`${a.url}-${i}`} style={styles.diagnosticLine}>
            • {a.url} — {String(a.status)}
          </Text>
        ))}
        <TouchableOpacity
          style={styles.cta}
          onPress={onBackToTeams}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaLabel}>Back to teams</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (stage.kind === 'matches-list') {
    return (
      <MatchesList
        stage={stage}
        onToggleMatch={onToggleMatch}
        onToggleAll={onToggleAll}
        onRunImport={onRunImport}
        colors={colors}
      />
    );
  }
  if (stage.kind === 'importing') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Importing…</Text>
        {stage.progress ? (
          <>
            <Text style={styles.cardMeta}>
              {stage.progress.index + 1} of {stage.progress.total}
            </Text>
            <Text style={styles.cardBody}>{stage.progress.label}</Text>
          </>
        ) : (
          <Text style={styles.cardBody}>Starting…</Text>
        )}
        <View style={styles.centeredBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }
  if (stage.kind === 'done') {
    const r = stage.result;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {'✓'} Imported {r.imported} match
          {r.imported === 1 ? '' : 'es'} for {stage.team.name}
        </Text>
        <Text style={styles.cardBody}>
          {r.skipped > 0
            ? `Skipped ${r.skipped} already in your library.\n`
            : ''}
          {r.failed > 0
            ? `Failed to import ${r.failed} — see warnings below.\n`
            : ''}
          {r.imported > 0
            ? `Open ${stage.team.name} in My Team to see your new analytics.`
            : ''}
        </Text>
        {r.warnings.length > 0 ? (
          <>
            <Text style={styles.diagnosticHeader}>Warnings:</Text>
            {r.warnings.slice(0, 6).map((w, i) => (
              <Text key={i} style={styles.diagnosticLine}>
                • {w}
              </Text>
            ))}
            {r.warnings.length > 6 ? (
              <Text style={styles.diagnosticLine}>
                …plus {r.warnings.length - 6} more (see logs)
              </Text>
            ) : null}
          </>
        ) : null}
        <TouchableOpacity
          style={styles.cta}
          onPress={onDone}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaLabel}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

function MatchesList({
  stage,
  onToggleMatch,
  onToggleAll,
  onRunImport,
  colors,
}: {
  stage: Extract<Stage, { kind: 'matches-list' }>;
  onToggleMatch: (matchId: string) => void;
  onToggleAll: () => void;
  onRunImport: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const selectedCount = useMemo(
    () => stage.matches.filter((m) => stage.selected[m.id]).length,
    [stage.matches, stage.selected]
  );
  const profile = stage.teamProfile;
  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{stage.team.name}</Text>
        <Text style={styles.cardMeta}>
          {stage.matches.length} match
          {stage.matches.length === 1 ? '' : 'es'} found · {selectedCount}{' '}
          selected
        </Text>
        {!profile ? (
          <View style={styles.warningBlock}>
            <Text style={styles.warningTitle}>Add this team first</Text>
            <Text style={styles.warningBody}>
              Add &ldquo;{stage.team.name}&rdquo; as one of your teams in
              My Team, then come back to import. The importer needs a
              matching local team to attach these matches to.
            </Text>
          </View>
        ) : (
          <Text style={styles.cardBody}>
            Imports will attach to <Text style={{ fontWeight: '700' }}>
              {profile.label}
            </Text>
            .
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.selectAllRow}
        onPress={onToggleAll}
        activeOpacity={0.7}
      >
        <Text style={styles.selectAllLabel}>
          {selectedCount === stage.matches.length
            ? 'Deselect all'
            : 'Select all'}
        </Text>
      </TouchableOpacity>
      {stage.matches.map((m) => {
        const isSelected = Boolean(stage.selected[m.id]);
        const scoreLabel =
          m.homeScore != null && m.awayScore != null
            ? `${m.homeScore}–${m.awayScore}`
            : 'pending';
        const dateLabel = m.dateMs
          ? new Date(m.dateMs).toLocaleDateString()
          : 'TBD';
        return (
          <TouchableOpacity
            key={m.id}
            style={styles.listRow}
            onPress={() => onToggleMatch(m.id)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.checkbox,
                isSelected && styles.checkboxOn,
              ]}
            >
              {isSelected ? (
                <Text style={styles.checkboxMark}>{'✓'}</Text>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listRowTitle}>vs {m.opponent}</Text>
              <Text style={styles.listRowMeta}>
                {dateLabel} · {scoreLabel}
                {m.eventName ? ` · ${m.eventName}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        style={[
          styles.cta,
          (selectedCount === 0 || !profile) && styles.ctaDisabled,
        ]}
        onPress={onRunImport}
        disabled={selectedCount === 0 || !profile}
        activeOpacity={0.7}
      >
        <Text style={styles.ctaLabel}>
          Import {selectedCount} match{selectedCount === 1 ? '' : 'es'}
        </Text>
      </TouchableOpacity>
    </>
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
      <Text style={styles.heroKicker}>MY TEAM</Text>
      <Text style={styles.heroTitle}>Import from Sideline HD</Text>
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
    loadingLabel: {
      marginTop: spacing.md,
      color: colors.textSecondary,
      fontSize: fontSize.sm,
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
    cardBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginBottom: spacing.md,
    },
    cardDebug: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontFamily: 'monospace',
      marginTop: spacing.sm,
    },
    diagnosticHeader: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    diagnosticLine: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontFamily: 'monospace',
      marginBottom: 2,
    },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    ctaDisabled: {
      opacity: 0.5,
    },
    ctaLabel: {
      color: colors.textOnPrimary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    secondaryCta: {
      backgroundColor: 'transparent',
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    secondaryCtaLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.xs,
    },
    listRowTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    listRowMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    chev: {
      color: colors.textLight,
      fontSize: fontSize.lg,
      paddingHorizontal: spacing.xs,
    },
    selectAllRow: {
      padding: spacing.sm,
      alignItems: 'flex-end',
      marginBottom: spacing.xs,
    },
    selectAllLabel: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: borderRadius.sm,
      borderWidth: 2,
      borderColor: colors.border,
      marginRight: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkboxMark: {
      color: colors.textOnPrimary,
      fontSize: fontSize.sm,
      fontWeight: '800',
    },
    warningBlock: {
      marginTop: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.primaryLight,
      borderRadius: borderRadius.sm,
      marginBottom: spacing.sm,
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
    webviewWrap: {
      flex: 1,
      backgroundColor: colors.background,
    },
    webviewLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    webviewFooter: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      alignItems: 'center',
    },
    webviewFooterText: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    webviewFooterLink: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
  });
}

/**
 * Stable route name for the launcher tile that the parallel home-screen
 * launcher session is wiring up. Keeping this exported as a constant so
 * both screens agree on the spelling.
 */
export const SIDELINE_IMPORT_ROUTE_NAME = 'import-sideline-hd';
