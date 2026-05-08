// ── verifyMatchMeta ────────────────────────────────────────────────────────
//
// Lightweight test harness for the Session α match-meta scaffolding:
//   • `defaultIncludeInStats` per matchKind
//   • on-read normalisation (legacy match → new fields filled in)
//   • the pure link / unlink / inclusion transformers
//   • the unified history filter behaviour for scored matches
//     (specifically the `respectIncludeInStats` opt-in)
//
// Mirrors `scripts/verifyMultiAthleteMigration.ts` in shape: no test
// framework dependency, just `test('name', () => …)` + a summary at
// the bottom.
//
// Run with sucrase-node (already in the parent repo's node_modules):
//   node ../node_modules/sucrase/bin/sucrase-node \
//     scripts/verifyMatchMeta.ts
//
// Or compile and run via tsc:
//   npx tsc --noEmit && \
//     npx tsc -p tsconfig.json --outDir .build/scripts && \
//     node .build/scripts/scripts/verifyMatchMeta.js
//
// Imports the *pure* helpers directly from `matchMetaPure.ts` so this
// script never touches the AsyncStorage import chain. The unified-
// history filter test stages a fake `LoadedIndices` shape and calls
// `buildMySeasonHistory` directly.
// ────────────────────────────────────────────────────────────────────────────

import {
  applyAesLink,
  applyMatchInclusion,
  applyTimuLink,
  applyUnlink,
  defaultIncludeInStats,
  normaliseMatch,
  normaliseMatchMeta,
} from '../src/utils/matchMetaPure';
import { buildMySeasonHistory } from '../src/utils/unifiedSeasonHistory';
import type {
  Match,
  MatchMeta,
  RosterPlayer,
  AesEventLink,
  TimuTournamentLink,
} from '../src/types/match';

// ── Tiny test runner ──────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail += 1;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}`);
    console.log(`      ${msg}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(
      `${msg}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    );
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

function legacyMeta(overrides: Partial<MatchMeta> = {}): MatchMeta {
  // Note: deliberately omits `matchKind`, `source`, `includeInStats` —
  // these are the new fields that older matches lack.
  return {
    eventName: 'Test Event',
    division: 'U18 Girls',
    matchLabel: 'Pool A · Match 1',
    courtName: 'Court 1',
    dateMs: FIXED_NOW - 10_000,
    sport: 'indoor',
    bestOf: 3,
    setTargets: { regular: 25, decider: 15, winBy: 2 },
    home: { label: 'Defensa Rob', liberoMayServe: false },
    away: { label: 'Pakmen U18', liberoMayServe: false },
    officials: {},
    coinToss: { serve: 'home', side: 'home-left' },
    ...overrides,
  };
}

function emptyRoster(): RosterPlayer[] {
  return [];
}

function legacyMatch(id: string, metaOverrides: Partial<MatchMeta> = {}): Match {
  return {
    id,
    meta: legacyMeta(metaOverrides),
    events: [],
    rosters: { home: emptyRoster(), away: emptyRoster() },
    status: 'complete',
    createdAt: FIXED_NOW - 10_000,
    updatedAt: FIXED_NOW - 10_000,
    schemaVersion: 1,
  };
}

const aesLink: AesEventLink = {
  eventId: 'AES-2024-PROVINCIALS',
  divisionId: '4',
  tournamentName: 'OVA Provincials 2024',
};

const timuLink: TimuTournamentLink = {
  tid: '12345',
  tournamentName: 'Trillium #4',
};

// ── Tests: defaultIncludeInStats ──────────────────────────────────────────

console.log('defaultIncludeInStats:');

test('AES → true', () => {
  assertEqual(defaultIncludeInStats('aes'), true, 'aes default');
});
test('Timu → true', () => {
  assertEqual(defaultIncludeInStats('timu'), true, 'timu default');
});
test('imported → true', () => {
  assertEqual(defaultIncludeInStats('imported'), true, 'imported default');
});
test('standalone → false', () => {
  assertEqual(defaultIncludeInStats('standalone'), false, 'standalone default');
});

// ── Tests: normaliseMatchMeta ─────────────────────────────────────────────

console.log('\nnormaliseMatchMeta (legacy migration):');

test('legacy meta with no new fields → standalone / tier2-live / false', () => {
  const meta = legacyMeta();
  const next = normaliseMatchMeta(meta);
  assertEqual(next.matchKind, 'standalone', 'matchKind defaults to standalone');
  assertEqual(next.source, 'tier2-live', 'source defaults to tier2-live');
  assertEqual(next.includeInStats, false, 'includeInStats defaults to false (matches standalone default)');
});

test('meta already populated → returned unchanged (same reference)', () => {
  const meta = legacyMeta({
    matchKind: 'aes',
    source: 'tier2-live',
    includeInStats: true,
  });
  const next = normaliseMatchMeta(meta);
  assert(next === meta, 'identity-equal: no change made');
});

test('partial population: matchKind: aes only → derived include matches kind default', () => {
  const meta = legacyMeta({ matchKind: 'aes' });
  const next = normaliseMatchMeta(meta);
  assertEqual(next.matchKind, 'aes', 'matchKind preserved');
  assertEqual(next.source, 'tier2-live', 'source filled in');
  assertEqual(
    next.includeInStats,
    true,
    'includeInStats inherits the AES default (true)'
  );
});

test('partial population: source: sideline-hd-import only → matchKind defaults to standalone', () => {
  const meta = legacyMeta({ source: 'sideline-hd-import' });
  const next = normaliseMatchMeta(meta);
  assertEqual(next.matchKind, 'standalone', 'matchKind not inferred from source');
  assertEqual(next.source, 'sideline-hd-import', 'source preserved');
  assertEqual(next.includeInStats, false, 'standalone default');
});

test('explicit includeInStats: true on a standalone match → preserved (user override)', () => {
  const meta = legacyMeta({ matchKind: 'standalone', includeInStats: true });
  const next = normaliseMatchMeta(meta);
  assertEqual(
    next.includeInStats,
    true,
    'user opt-in is not overwritten by the standalone default'
  );
});

// ── Tests: normaliseMatch ─────────────────────────────────────────────────

console.log('\nnormaliseMatch (legacy match-record migration):');

test('legacy match → meta normalised, identity preserved on already-normalised', () => {
  const m1 = legacyMatch('m1');
  const m1n = normaliseMatch(m1);
  assertEqual(m1n.meta.matchKind, 'standalone', 'meta.matchKind defaulted');
  assertEqual(m1n.id, 'm1', 'id preserved');
  assertEqual(m1n.events.length, 0, 'events preserved');
  // Re-normalise should be a no-op (identity-stable)
  const m1n2 = normaliseMatch(m1n);
  assert(m1n2 === m1n, 'second pass identity-equal');
});

// ── Tests: pure link / unlink / inclusion transformers ──────────────────

console.log('\napplyMatchInclusion / applyAesLink / applyTimuLink / applyUnlink:');

test('applyMatchInclusion(true) on standalone → flips include flag, normalises', () => {
  const m = legacyMatch('m1');
  const next = applyMatchInclusion(m, true, FIXED_NOW);
  assertEqual(next.meta.includeInStats, true, 'flag set');
  assertEqual(next.meta.matchKind, 'standalone', 'matchKind still standalone');
  assertEqual(next.updatedAt, FIXED_NOW, 'updatedAt bumped to passed-in now');
});

test('applyAesLink → matchKind becomes aes, link attached, timu link cleared', () => {
  // Start with a match that *already* has a stale Timu link.
  const m = legacyMatch('m1', {
    matchKind: 'timu',
    linkedTimuTournament: timuLink,
  });
  const next = applyAesLink(m, aesLink, FIXED_NOW);
  assertEqual(next.meta.matchKind, 'aes', 'matchKind flipped to aes');
  assertEqual(
    next.meta.linkedAesEvent?.eventId,
    aesLink.eventId,
    'AES link attached'
  );
  assert(
    next.meta.linkedTimuTournament === undefined,
    'prior Timu link cleared'
  );
});

test('applyTimuLink → matchKind becomes timu, link attached, aes link cleared', () => {
  const m = legacyMatch('m1', {
    matchKind: 'aes',
    linkedAesEvent: aesLink,
  });
  const next = applyTimuLink(m, timuLink, FIXED_NOW);
  assertEqual(next.meta.matchKind, 'timu', 'matchKind flipped to timu');
  assertEqual(
    next.meta.linkedTimuTournament?.tid,
    timuLink.tid,
    'Timu link attached'
  );
  assert(next.meta.linkedAesEvent === undefined, 'prior AES link cleared');
});

test('applyUnlink → matchKind drops to standalone, both links cleared, includeInStats preserved', () => {
  const m = legacyMatch('m1', {
    matchKind: 'aes',
    linkedAesEvent: aesLink,
    includeInStats: true,
  });
  const next = applyUnlink(m, FIXED_NOW);
  assertEqual(next.meta.matchKind, 'standalone', 'demoted to standalone');
  assert(next.meta.linkedAesEvent === undefined, 'AES link gone');
  assert(next.meta.linkedTimuTournament === undefined, 'Timu link gone');
  assertEqual(
    next.meta.includeInStats,
    true,
    'user includeInStats preserved (not reset to standalone default)'
  );
});

test('applyAesLink on a legacy unnormalised match → new fields are filled in', () => {
  const m = legacyMatch('m1'); // missing matchKind/source/includeInStats
  const next = applyAesLink(m, aesLink, FIXED_NOW);
  assertEqual(next.meta.matchKind, 'aes', 'matchKind set');
  assertEqual(next.meta.source, 'tier2-live', 'source defaulted');
  // includeInStats was originally absent → defaultIncludeInStats('standalone') = false
  // applyAesLink does NOT recompute include based on the new kind — it only
  // ensures the meta is normalised, then stamps the link. That's a deliberate
  // contract: include flips are an explicit user action.
  assertEqual(
    next.meta.includeInStats,
    false,
    'includeInStats keeps its normalised value (user must flip explicitly)'
  );
});

// ── Tests: buildMySeasonHistory + scored matches ─────────────────────────

console.log('\nbuildMySeasonHistory (scored entries + respectIncludeInStats):');

const aliases = ['Defensa Rob'];

function makeScoredMatch(
  id: string,
  overrides: Partial<MatchMeta> = {}
): Match {
  return {
    id,
    meta: {
      ...legacyMeta(),
      matchKind: 'standalone',
      source: 'tier2-live',
      includeInStats: false,
      ...overrides,
    },
    events: [],
    rosters: { home: emptyRoster(), away: emptyRoster() },
    status: 'complete',
    createdAt: FIXED_NOW - 10_000,
    updatedAt: FIXED_NOW - 5_000,
    schemaVersion: 1,
  };
}

test('scored match whose home label matches alias → entry is produced', () => {
  const indices = {
    timu: {},
    aes: {},
    scored: [makeScoredMatch('m1', { matchKind: 'aes', includeInStats: true })],
  };
  const out = buildMySeasonHistory(indices, aliases);
  assertEqual(out.length, 1, 'one entry produced');
  assertEqual(out[0].source, 'scored', 'source tag is "scored"');
  assertEqual(out[0].matchId, 'm1', 'matchId set');
});

test('scored match whose home/away labels do NOT match alias → entry is skipped', () => {
  const indices = {
    timu: {},
    aes: {},
    scored: [
      makeScoredMatch('m1', {
        home: { label: 'Some Other Team' },
        away: { label: 'Yet Another Team' },
      }),
    ],
  };
  const out = buildMySeasonHistory(indices, aliases);
  assertEqual(out.length, 0, 'no entry when alias misses both sides');
});

test('respectIncludeInStats=true drops includeInStats:false entries; default keeps them', () => {
  const indices = {
    timu: {},
    aes: {},
    scored: [
      // includeInStats=false → kept by default, dropped when respect=true
      makeScoredMatch('m1', {
        matchKind: 'standalone',
        includeInStats: false,
      }),
      // includeInStats=true → kept always
      makeScoredMatch('m2', { matchKind: 'aes', includeInStats: true }),
    ],
  };
  const lenient = buildMySeasonHistory(indices, aliases);
  assertEqual(lenient.length, 2, 'default keeps every alias-matched scored entry');

  const strict = buildMySeasonHistory(indices, aliases, {
    respectIncludeInStats: true,
  });
  assertEqual(strict.length, 1, 'strict mode drops includeInStats:false');
  assertEqual(strict[0].matchId, 'm2', 'kept entry is the include:true one');
});

test('alias matches the away side → entry is still produced (user playing as away)', () => {
  const indices = {
    timu: {},
    aes: {},
    scored: [
      makeScoredMatch('m1', {
        home: { label: 'Other Team' },
        away: { label: 'Defensa Rob' },
        matchKind: 'aes',
        includeInStats: true,
      }),
    ],
  };
  const out = buildMySeasonHistory(indices, aliases);
  assertEqual(out.length, 1, 'away-side match produces an entry');
  assertEqual(out[0].myTeamAsSeen, 'Defensa Rob', 'myTeamAsSeen reflects away label');
  assertEqual(
    out[0].matches[0].opponentName,
    'Other Team',
    'opponent is the home team'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
