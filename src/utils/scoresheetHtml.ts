// ── OVA scoresheet HTML renderer ──────────────────────────────────────────
//
// Pure function: takes a completed Tier 2 `Match` and returns a printable
// HTML string that mirrors the OVA youth scoresheet's data layout. The
// caller pipes the HTML through `expo-print` to produce a PDF; this
// module itself has no native dependencies and can be unit-tested in
// vitest.
//
// The brief asks for "paper-fidelity OVA scoresheet"; this first pass
// captures every required data point on a clean, readable layout
// (one section per set + match summary + signatures). Pixel-perfect
// fidelity to the OVA paper sheet is a follow-up.
//
// Data sources (all derived from `Match`):
//   • `meta` → header block (tournament / division / venue / officials)
//   • `events` (filtered by setIndex) → per-set lineup + point progression
//     + subs log + timeouts + sanctions + set start/end timestamps
//   • `rosters` → shirt-#-to-name lookup
//
// The renderer is intentionally tolerant of partial data: any field
// that's missing renders as a blank cell (matching the experience of
// a paper sheet with empty boxes).
// ────────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  LineupEvent,
  PointEvent,
  SubEvent,
  TimeoutEvent,
  SanctionEvent,
  SetEndEvent,
  MatchEndEvent,
  RosterPlayer,
  Side,
} from '../types/match';

/**
 * Render a completed match as a printable HTML scoresheet.
 * Returns a fully-self-contained HTML document (inline CSS, no
 * external assets) suitable for piping into `expo-print`.
 */
export function renderMatchScoresheetHtml(match: Match): string {
  const meta = match.meta;
  const sets = groupEventsBySet(match.events);
  const matchEndEv = match.events.find(
    (e): e is MatchEndEvent => e.type === 'match-end'
  );

  const homeName = escapeHtml(meta.home.label || 'Home');
  const awayName = escapeHtml(meta.away.label || 'Away');
  const homeColor = meta.home.colorHex || '#1f5fb0';
  const awayColor = meta.away.colorHex || '#b03030';

  const setSections = sets
    .map((s) => renderSetSection(s, match))
    .join('\n');

  const setsWonHome = matchEndEv?.setsHome ?? sets.filter((s) => s.winner === 'home').length;
  const setsWonAway = matchEndEv?.setsAway ?? sets.filter((s) => s.winner === 'away').length;
  const durationMs = matchEndEv?.durationMs ?? sets.reduce((acc, s) => acc + s.durationMs, 0);

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${escapeHtml(meta.eventName)} — ${escapeHtml(meta.matchLabel || 'Match')}</title>
<style>${SHEET_CSS}</style>
</head><body>
  <div class="sheet">
    <header class="hdr">
      <div class="hdr-title">OVA SCORESHEET</div>
      <div class="hdr-meta">
        <div><strong>${escapeHtml(meta.eventName || '')}</strong></div>
        <div>${escapeHtml(meta.division || '')}${meta.tournamentContext?.poolPhase ? ' · ' + escapeHtml(meta.tournamentContext.poolPhase) : ''}</div>
        <div>${escapeHtml(meta.matchLabel || '')}${meta.courtName ? ' · ' + escapeHtml(meta.courtName) : ''}</div>
        <div>${formatDate(meta.dateMs)}${meta.venue?.hallName ? ' · ' + escapeHtml(meta.venue.hallName) : ''}${meta.venue?.city ? ', ' + escapeHtml(meta.venue.city) : ''}</div>
        ${meta.tournamentContext?.matchNumber ? `<div>Match N° ${escapeHtml(meta.tournamentContext.matchNumber)}</div>` : ''}
      </div>
    </header>

    <section class="teams">
      <div class="team-card" style="border-left-color:${homeColor}">
        <div class="team-label">HOME</div>
        <div class="team-name">${homeName}</div>
        ${renderStaffBlock(meta.home)}
        ${renderRosterTable(match.rosters.home)}
      </div>
      <div class="team-card" style="border-left-color:${awayColor}">
        <div class="team-label">AWAY</div>
        <div class="team-name">${awayName}</div>
        ${renderStaffBlock(meta.away)}
        ${renderRosterTable(match.rosters.away)}
      </div>
    </section>

    ${renderOfficialsBlock(match)}

    ${setSections}

    <section class="summary">
      <h3>MATCH SUMMARY</h3>
      <table class="summary-tbl">
        <thead><tr><th></th><th>${homeName}</th><th>${awayName}</th></tr></thead>
        <tbody>
          ${sets
            .map(
              (s) =>
                `<tr><td>Set ${s.setIndex + 1}</td><td>${s.homeFinal}</td><td>${s.awayFinal}</td></tr>`
            )
            .join('')}
          <tr class="totals"><td>Sets won</td><td>${setsWonHome}</td><td>${setsWonAway}</td></tr>
          <tr><td>Duration</td><td colspan="2">${formatDuration(durationMs)}</td></tr>
          <tr><td>Result</td><td colspan="2">${renderFinalResult(setsWonHome, setsWonAway, homeName, awayName)}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="sigs">
      <h3>SIGNATURES</h3>
      <div class="sig-row">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${homeName} Captain</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${awayName} Captain</div></div>
      </div>
      <div class="sig-row">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${homeName} Coach</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${awayName} Coach</div></div>
      </div>
      <div class="sig-row">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">1st Referee</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">2nd Referee</div></div>
      </div>
      <div class="sig-row">
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">Scorer</div></div>
        <div class="sig-box"><div class="sig-line"></div><div class="sig-label">Assistant Scorer</div></div>
      </div>
    </section>

    <footer class="ftr">Generated by AES Volleyball · ${formatDate(Date.now())}</footer>
  </div>
</body></html>`;
}

// ── Per-set rendering ──────────────────────────────────────────────────────

interface SetGroup {
  setIndex: number;
  events: MatchEvent[];
  lineup: { home?: LineupEvent; away?: LineupEvent };
  points: PointEvent[];
  subs: SubEvent[];
  timeouts: TimeoutEvent[];
  sanctions: SanctionEvent[];
  setEnd?: SetEndEvent;
  startMs?: number;
  endMs?: number;
  homeFinal: number;
  awayFinal: number;
  winner: Side | null;
  durationMs: number;
}

function groupEventsBySet(events: MatchEvent[]): SetGroup[] {
  const byIdx = new Map<number, SetGroup>();
  for (const e of events) {
    if (e.type === 'match-end' || e.type === 'match-abandoned') continue;
    const g =
      byIdx.get(e.setIndex) ??
      ({
        setIndex: e.setIndex,
        events: [],
        lineup: {},
        points: [],
        subs: [],
        timeouts: [],
        sanctions: [],
        homeFinal: 0,
        awayFinal: 0,
        winner: null,
        durationMs: 0,
      } as SetGroup);
    g.events.push(e);
    if (e.type === 'lineup') {
      if (e.team === 'home') g.lineup.home = e;
      else g.lineup.away = e;
      g.startMs = Math.min(g.startMs ?? e.ts, e.ts);
    }
    if (e.type === 'point') g.points.push(e);
    if (e.type === 'sub') g.subs.push(e);
    if (e.type === 'timeout') g.timeouts.push(e);
    if (e.type === 'sanction') g.sanctions.push(e);
    if (e.type === 'set-end') {
      g.setEnd = e;
      g.endMs = e.ts;
      g.homeFinal = e.homeFinal;
      g.awayFinal = e.awayFinal;
      g.durationMs = e.durationMs;
      g.winner = e.homeFinal > e.awayFinal ? 'home' : 'away';
    }
    byIdx.set(e.setIndex, g);
  }
  // Fall back to last-point scores when set-end is absent.
  for (const g of byIdx.values()) {
    if (!g.setEnd && g.points.length > 0) {
      const last = g.points[g.points.length - 1];
      const snap = last.courtSnapshot;
      if (snap) {
        // Server changes shouldn't matter; we just want a final score.
      }
      // Walk points to recompute final.
      let h = 0;
      let a = 0;
      for (const p of g.points) {
        if (p.scoringTeam === 'home') h++;
        else a++;
      }
      g.homeFinal = h;
      g.awayFinal = a;
      g.winner = h > a ? 'home' : a > h ? 'away' : null;
    }
  }
  return [...byIdx.values()].sort((a, b) => a.setIndex - b.setIndex);
}

function renderSetSection(s: SetGroup, match: Match): string {
  const homeName = escapeHtml(match.meta.home.label || 'Home');
  const awayName = escapeHtml(match.meta.away.label || 'Away');
  const winnerName = s.winner === 'home' ? homeName : s.winner === 'away' ? awayName : '—';

  return `
  <section class="set">
    <h3>SET ${s.setIndex + 1} <span class="set-final">${s.homeFinal}–${s.awayFinal}</span> <span class="set-winner">Winner: ${winnerName}</span></h3>
    <div class="set-meta">
      Start: ${s.startMs ? formatTime(s.startMs) : '—'}
      &nbsp;·&nbsp; End: ${s.endMs ? formatTime(s.endMs) : '—'}
      &nbsp;·&nbsp; Duration: ${formatDuration(s.durationMs)}
    </div>

    <div class="set-cols">
      <div class="lineup-block">
        <h4>STARTING LINEUPS</h4>
        ${renderLineupTable(s.lineup.home, match.rosters.home, homeName)}
        ${renderLineupTable(s.lineup.away, match.rosters.away, awayName)}
      </div>

      <div class="pts-block">
        <h4>POINT PROGRESSION</h4>
        ${renderPointProgression(s, match)}
      </div>
    </div>

    <div class="set-cols">
      <div class="subs-block">
        <h4>SUBSTITUTIONS</h4>
        ${renderSubsTable(s.subs, match)}
      </div>

      <div class="to-block">
        <h4>TIMEOUTS</h4>
        ${renderTimeouts(s.timeouts, match)}
        ${s.sanctions.length > 0 ? `<h4 style="margin-top:8px">SANCTIONS</h4>${renderSanctions(s.sanctions, match)}` : ''}
      </div>
    </div>
  </section>`;
}

function renderLineupTable(
  lu: LineupEvent | undefined,
  roster: RosterPlayer[],
  teamName: string
): string {
  if (!lu) {
    return `<div class="lineup-row"><span class="lineup-team">${teamName}</span><span class="lineup-empty">No lineup recorded</span></div>`;
  }
  const cells = lu.positions
    .map((shirt, i) => {
      const pos = i + 1;
      const name = nameForShirt(roster, shirt);
      return `<td><div class="pos-tag">${romanNumeral(pos)}</div><div class="shirt">#${shirt}</div>${name ? `<div class="player-name">${escapeHtml(name)}</div>` : ''}</td>`;
    })
    .join('');
  const liberos = lu.liberos
    .map((l) => `#${l}${nameForShirt(roster, l) ? ' ' + escapeHtml(nameForShirt(roster, l)!) : ''}`)
    .join(', ');
  return `
    <div class="lineup-row">
      <div class="lineup-team">${teamName}</div>
      <table class="lineup-tbl"><tr>${cells}</tr></table>
      <div class="lineup-libero">Libero: ${liberos || '—'}${lu.firstServer ? ` · 1st server: ${lu.firstServer === 'home' ? 'Home' : 'Away'}` : ''}</div>
    </div>`;
}

function renderPointProgression(s: SetGroup, match: Match): string {
  if (s.points.length === 0) {
    return `<div class="empty-cell">No points recorded.</div>`;
  }
  let h = 0;
  let a = 0;
  const rows = s.points
    .map((p, idx) => {
      if (p.scoringTeam === 'home') h++;
      else a++;
      const snap = p.courtSnapshot;
      const server = snap
        ? `${snap.server === 'home' ? 'H' : 'A'} #${snap.serverShirt}`
        : '—';
      const scorer = p.shirt ? `#${p.shirt}` : '';
      const reason = p.reason ?? '';
      const player =
        p.shirt && p.scoringTeam
          ? nameForShirt(match.rosters[p.scoringTeam], p.shirt)
          : null;
      return `<tr>
        <td>${idx + 1}</td>
        <td>${p.scoringTeam === 'home' ? '●' : ''}</td>
        <td>${p.scoringTeam === 'away' ? '●' : ''}</td>
        <td class="score-col">${h}–${a}</td>
        <td>${server}</td>
        <td>${scorer}${player ? ' ' + escapeHtml(player) : ''}</td>
        <td>${reason}</td>
      </tr>`;
    })
    .join('');
  return `
    <table class="pts-tbl">
      <thead><tr><th>#</th><th>H</th><th>A</th><th>Score</th><th>Server</th><th>Scorer</th><th>Reason</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSubsTable(subs: SubEvent[], match: Match): string {
  if (subs.length === 0) {
    return `<div class="empty-cell">No substitutions.</div>`;
  }
  const rows = subs
    .map((sub) => {
      const roster = match.rosters[sub.team];
      const outName = nameForShirt(roster, sub.out);
      const inName = nameForShirt(roster, sub.in);
      const teamLabel = sub.team === 'home' ? 'H' : 'A';
      return `<tr>
        <td>${teamLabel}</td>
        <td>#${sub.out}${outName ? ' ' + escapeHtml(outName) : ''}</td>
        <td>→</td>
        <td>#${sub.in}${inName ? ' ' + escapeHtml(inName) : ''}</td>
        <td>${sub.exceptional ? 'Exc.' : ''}</td>
      </tr>`;
    })
    .join('');
  return `<table class="subs-tbl"><thead><tr><th>Team</th><th>Out</th><th></th><th>In</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTimeouts(timeouts: TimeoutEvent[], _match: Match): string {
  if (timeouts.length === 0) {
    return `<div class="empty-cell">No timeouts.</div>`;
  }
  const rows = timeouts
    .map(
      (t, i) =>
        `<tr><td>${i + 1}</td><td>${t.team === 'home' ? 'H' : 'A'}</td><td>${t.technical ? 'TTO' : 'Req.'}</td><td>${formatTime(t.ts)}</td></tr>`
    )
    .join('');
  return `<table class="subs-tbl"><thead><tr><th>#</th><th>Team</th><th>Type</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSanctions(sanctions: SanctionEvent[], _match: Match): string {
  const rows = sanctions
    .map((s) => {
      const tgt = s.shirt ? `#${s.shirt}` : s.target;
      return `<tr>
        <td>${s.team === 'home' ? 'H' : 'A'}</td>
        <td>${s.level}</td>
        <td>${escapeHtml(String(tgt))}</td>
        <td>${escapeHtml(s.reason ?? '')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="subs-tbl"><thead><tr><th>Team</th><th>Level</th><th>Target</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ── Header sub-blocks ──────────────────────────────────────────────────────

function renderStaffBlock(team: Match['meta']['home']): string {
  const rows: string[] = [];
  if (team.coachName) rows.push(`<div>Coach: ${escapeHtml(team.coachName)}</div>`);
  if (team.assistantCoachName) rows.push(`<div>AC: ${escapeHtml(team.assistantCoachName)}</div>`);
  if (team.captainShirt) rows.push(`<div>Captain: #${team.captainShirt}</div>`);
  if (team.teamTherapistName) rows.push(`<div>Therapist: ${escapeHtml(team.teamTherapistName)}</div>`);
  if (team.medicalDoctorName) rows.push(`<div>Medical: ${escapeHtml(team.medicalDoctorName)}</div>`);
  return rows.length > 0 ? `<div class="staff">${rows.join('')}</div>` : '';
}

function renderRosterTable(roster: RosterPlayer[]): string {
  if (roster.length === 0) return '<div class="empty-cell">No roster recorded.</div>';
  const rows = roster
    .filter((p) => p.active !== false)
    .map((p) => {
      const tags: string[] = [];
      if (p.isCaptain) tags.push('C');
      if (p.isLibero) tags.push('L');
      if (p.position) tags.push(p.position);
      return `<tr>
        <td class="shirt-col">#${p.shirt}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${tags.join(' / ')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="roster-tbl"><thead><tr><th>#</th><th>Player</th><th>Role</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderOfficialsBlock(match: Match): string {
  const o = match.meta.officials || {};
  const lines: string[] = [];
  if (o.first) lines.push(`1st Referee: ${escapeHtml(o.first)}`);
  if (o.second) lines.push(`2nd Referee: ${escapeHtml(o.second)}`);
  if (o.scorerName) lines.push(`Scorer: ${escapeHtml(o.scorerName)}`);
  if (o.assistantScorerName) lines.push(`Asst. Scorer: ${escapeHtml(o.assistantScorerName)}`);
  if (o.lineJudges && o.lineJudges.length > 0)
    lines.push(`Line Judges: ${o.lineJudges.map(escapeHtml).join(', ')}`);
  if (lines.length === 0) return '';
  return `<section class="officials"><h3>OFFICIALS</h3><div>${lines.join(' &nbsp;·&nbsp; ')}</div></section>`;
}

function renderFinalResult(setsHome: number, setsAway: number, homeName: string, awayName: string): string {
  if (setsHome === setsAway) return `Tied ${setsHome}–${setsAway}`;
  const winner = setsHome > setsAway ? homeName : awayName;
  return `${winner} wins ${setsHome}–${setsAway}`;
}

// ── Formatters ────────────────────────────────────────────────────────────

function nameForShirt(roster: RosterPlayer[], shirt: number): string | null {
  const p = roster.find((r) => r.shirt === shirt);
  return p ? p.name : null;
}

function romanNumeral(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V', 'VI'][n - 1] ?? String(n);
}

function formatDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Print stylesheet ──────────────────────────────────────────────────────
//
// Print-targeted CSS. `@page` margins keep one set per page reasonably
// well; the renderer doesn't aggressively page-break, but we set
// `page-break-inside: avoid` on each set section so a set won't split
// across pages if it fits on one.

const SHEET_CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: #111; margin: 0; }
  .sheet { padding: 0; }
  h3 { margin: 16px 0 6px; font-size: 11pt; letter-spacing: 1px; border-bottom: 2px solid #111; padding-bottom: 3px; }
  h4 { margin: 8px 0 4px; font-size: 10pt; letter-spacing: 0.5px; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  table td, table th { border: 1px solid #999; padding: 3px 5px; font-size: 9pt; vertical-align: top; }
  table th { background: #f0f0f0; font-weight: 700; text-align: left; }
  .hdr { border-bottom: 3px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .hdr-title { font-size: 18pt; font-weight: 900; letter-spacing: 2px; }
  .hdr-meta { font-size: 9.5pt; line-height: 1.4; margin-top: 4px; }
  .teams { display: flex; gap: 8px; margin-bottom: 10px; }
  .team-card { flex: 1; border: 1px solid #999; border-left-width: 6px; padding: 6px 8px; }
  .team-label { font-size: 8pt; color: #666; letter-spacing: 1px; font-weight: 700; }
  .team-name { font-size: 13pt; font-weight: 800; margin-bottom: 4px; }
  .staff { font-size: 9pt; color: #333; margin-bottom: 6px; }
  .roster-tbl { font-size: 9pt; }
  .shirt-col { width: 36px; text-align: center; font-weight: 700; }
  .officials { margin-bottom: 10px; font-size: 9.5pt; }
  .set { page-break-inside: avoid; margin-bottom: 14px; }
  .set h3 { display: flex; align-items: baseline; gap: 12px; }
  .set-final { font-size: 14pt; font-weight: 900; letter-spacing: 0; }
  .set-winner { font-size: 9pt; color: #666; font-weight: 500; letter-spacing: 0; }
  .set-meta { font-size: 9pt; color: #555; margin-bottom: 6px; }
  .set-cols { display: flex; gap: 10px; margin-bottom: 8px; }
  .set-cols > div { flex: 1; }
  .lineup-row { margin-bottom: 8px; }
  .lineup-team { font-weight: 700; margin-bottom: 3px; font-size: 9.5pt; }
  .lineup-tbl td { text-align: center; padding: 4px 2px; width: 16.66%; }
  .lineup-tbl .pos-tag { font-size: 7pt; color: #888; font-weight: 700; letter-spacing: 1px; }
  .lineup-tbl .shirt { font-size: 11pt; font-weight: 800; }
  .lineup-tbl .player-name { font-size: 8pt; color: #333; line-height: 1.1; }
  .lineup-libero { font-size: 8.5pt; color: #444; margin-top: 2px; }
  .pts-tbl td, .pts-tbl th { font-size: 8pt; padding: 2px 4px; }
  .pts-tbl .score-col { font-weight: 700; }
  .subs-tbl td, .subs-tbl th { font-size: 8.5pt; }
  .empty-cell { font-size: 9pt; color: #888; font-style: italic; padding: 4px 0; }
  .summary { page-break-inside: avoid; margin-top: 12px; }
  .summary-tbl { width: 60%; }
  .summary-tbl .totals td { font-weight: 800; background: #f4f4f4; }
  .sigs { margin-top: 16px; page-break-inside: avoid; }
  .sig-row { display: flex; gap: 16px; margin-bottom: 14px; }
  .sig-box { flex: 1; }
  .sig-line { border-bottom: 1px solid #000; height: 22px; }
  .sig-label { font-size: 8pt; color: #666; margin-top: 2px; }
  .ftr { margin-top: 20px; padding-top: 6px; border-top: 1px dashed #999; font-size: 8pt; color: #888; text-align: center; }
`;
