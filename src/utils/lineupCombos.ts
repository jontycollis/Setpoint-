// ── Lineup combinations ───────────────────────────────────────────────────
//
// Analytics slice 3 of the workbook port. Mirrors the workbook's
// "Lineup Combinations" tab — two views over 6-player on-court groupings:
//
//   A) Ranked by rally win % among combos that played ≥ minRallies
//      together (workbook default: 30).
//   B) Ranked by set win % among combos that "dominated" ≥ minDominated
//      sets — i.e. were the primary 6 on the floor for that set, measured
//      by which combo had the most rallies in that set. Workbook default:
//      3 sets.
//
// Display order: player names sorted alphabetically (matches the workbook
// convention). The combo identity (the *key*) uses the sorted shirt list
// so the same six players collapse regardless of court position.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
import { matchPassesFilter, teamSide, type MatchFilter } from './analytics';
import { walkTeamRallies, type RallyClassification } from './teamRallyWalk';

export interface LineupComboLine {
  /** Stable hash of the 6 shirt #s sorted ascending. */
  comboKey: string;
  /** Shirts in alphabetical-by-name order (matches playerNames). */
  shirts: number[];
  playerNames: string[];
  rallies: number;
  ralliesWon: number;
  rallyWinPct: number;
  /** Sets where this combo had the plurality of rallies. */
  setsDominated: number;
  setsDominatedWon: number;
  /** % of dominated sets the team won. NaN when setsDominated = 0. */
  setDominatedWinPct: number;
  /** Number of distinct sets the combo appeared in for ≥ 1 rally. */
  setsAppeared: number;
}

export interface LineupCombosSummary {
  combos: LineupComboLine[];
  /** Total rallies the walker classified — denominator for combo share. */
  totalRallies: number;
}

interface ComboAcc {
  comboKey: string;
  shirts: number[];
  playerNames: string[];
  rallies: number;
  ralliesWon: number;
  /** Per-set rally counts so we can compute "appeared in N sets". */
  setRallyCounts: Map<string, number>;
  /** Sets this combo dominated (had plurality of rallies in), mapped to
   *  the team's outcome for that set. */
  dominanceSets: Map<string, 'win' | 'loss' | null>;
}

export function aggregateLineupCombos(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): LineupCombosSummary {
  const combos = new Map<string, ComboAcc>();
  let totalRallies = 0;

  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const ourSide = teamSide(match, teamProfileId);
    if (!ourSide) continue;
    const roster = ourSide === 'home' ? match.rosters.home : match.rosters.away;
    const nameByShirt = new Map<number, string>();
    for (const p of roster) nameByShirt.set(p.shirt, p.name);

    const walk = walkTeamRallies(match, ourSide);
    if (!walk.contributedAny) continue;
    const setOutcomeByIdx = new Map<number, 'win' | 'loss' | null>();
    for (const r of walk.setResults) setOutcomeByIdx.set(r.setIndex, r.outcome);

    // Per-match: setKey → (comboKey → rally count). After the match,
    // the combo with the plurality of rallies in each set is the
    // "dominant" combo.
    const perSetComboCounts = new Map<string, Map<string, number>>();

    for (const rally of walk.rallies) {
      totalRallies++;
      const acc = ensureCombo(combos, rally, nameByShirt);
      acc.rallies++;
      if (rally.scoringTeam === ourSide) acc.ralliesWon++;

      const setKey = `${match.id}#${rally.setIndex}`;
      acc.setRallyCounts.set(setKey, (acc.setRallyCounts.get(setKey) ?? 0) + 1);

      let comboCounts = perSetComboCounts.get(setKey);
      if (!comboCounts) {
        comboCounts = new Map();
        perSetComboCounts.set(setKey, comboCounts);
      }
      comboCounts.set(acc.comboKey, (comboCounts.get(acc.comboKey) ?? 0) + 1);
    }

    // Assign dominance per set, tagging the combo with the set outcome.
    for (const [setKey, comboCounts] of perSetComboCounts) {
      let topCombo: string | null = null;
      let topCount = -1;
      for (const [combo, c] of comboCounts) {
        if (c > topCount) {
          topCount = c;
          topCombo = combo;
        }
      }
      if (topCombo) {
        const acc = combos.get(topCombo);
        if (acc) {
          // setKey's setIndex is the trailing token after '#'.
          const setIdx = Number(setKey.slice(setKey.lastIndexOf('#') + 1));
          acc.dominanceSets.set(setKey, setOutcomeByIdx.get(setIdx) ?? null);
        }
      }
    }
  }

  const lines: LineupComboLine[] = [];
  for (const acc of combos.values()) {
    const setsAppeared = acc.setRallyCounts.size;
    const setsDominated = acc.dominanceSets.size;
    let setsDominatedWon = 0;
    for (const o of acc.dominanceSets.values()) if (o === 'win') setsDominatedWon++;
    lines.push({
      comboKey: acc.comboKey,
      shirts: acc.shirts,
      playerNames: acc.playerNames,
      rallies: acc.rallies,
      ralliesWon: acc.ralliesWon,
      rallyWinPct: acc.rallies > 0 ? acc.ralliesWon / acc.rallies : NaN,
      setsDominated,
      setsDominatedWon,
      setDominatedWinPct:
        setsDominated > 0 ? setsDominatedWon / setsDominated : NaN,
      setsAppeared,
    });
  }
  return { combos: lines, totalRallies };
}

/**
 * Top N combos by rally win % among combos with ≥ minRallies. Default
 * threshold matches the workbook (30 rallies).
 */
export function topCombosByRallyWinPct(
  summary: LineupCombosSummary,
  minRallies = 30,
  topN = 10
): LineupComboLine[] {
  return summary.combos
    .filter((c) => c.rallies >= minRallies)
    .slice()
    .sort(
      (a, b) =>
        b.rallyWinPct - a.rallyWinPct ||
        b.rallies - a.rallies ||
        a.comboKey.localeCompare(b.comboKey)
    )
    .slice(0, topN);
}

/**
 * Top N combos by set win % when "dominant" (combo played the most
 * rallies in the set), among combos that dominated ≥ minDominated sets.
 * Workbook default: 3 sets.
 */
export function topCombosBySetDomination(
  summary: LineupCombosSummary,
  minDominated = 3,
  topN = 10
): LineupComboLine[] {
  return summary.combos
    .filter((c) => c.setsDominated >= minDominated)
    .slice()
    .sort(
      (a, b) =>
        b.setDominatedWinPct - a.setDominatedWinPct ||
        b.setsDominated - a.setsDominated ||
        a.comboKey.localeCompare(b.comboKey)
    )
    .slice(0, topN);
}

// ── Internals ─────────────────────────────────────────────────────────────

function ensureCombo(
  combos: Map<string, ComboAcc>,
  rally: RallyClassification,
  nameByShirt: Map<number, string>
): ComboAcc {
  const shirts = [...rally.ourOnCourt].sort((a, b) => a - b);
  const key = shirts.join('-');
  let acc = combos.get(key);
  if (!acc) {
    const nameOrdered = shirts
      .map((s) => ({ shirt: s, name: nameByShirt.get(s) ?? `#${s}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    acc = {
      comboKey: key,
      shirts: nameOrdered.map((p) => p.shirt),
      playerNames: nameOrdered.map((p) => p.name),
      rallies: 0,
      ralliesWon: 0,
      setRallyCounts: new Map(),
      dominanceSets: new Map(),
    };
    combos.set(key, acc);
  }
  return acc;
}
