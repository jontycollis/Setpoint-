// ── verifyMultiAthleteMigration ───────────────────────────────────────────
//
// Lightweight test harness for the v1 → v2 multi-athlete migration. Mirrors
// the style of existing verification scripts: no test framework dependency,
// just a flat list of `test('name', () => ...)` calls and a summary at the
// end.
//
// Run with sucrase-node (already in the parent repo's node_modules):
//   node ../node_modules/sucrase/bin/sucrase-node \
//     scripts/verifyMultiAthleteMigration.ts
//
// Or compile and run via tsc:
//   npx tsc --noEmit && \
//     npx tsc -p tsconfig.json --outDir .build/scripts && \
//     node .build/scripts/scripts/verifyMultiAthleteMigration.js
//
// Imports only the pure migration helpers — does NOT touch
// `userProfile.ts`, which pulls AsyncStorage at module load.
// ────────────────────────────────────────────────────────────────────────────

import {
  buildV2FromV1,
  getActiveAthlete,
  getTeamsForAthlete,
} from '../src/utils/userProfileMigration';
import type {
  TeamProfile,
  UserProfile,
  UserProfileV1,
} from '../src/types/profile';

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

function makeMeTeam(id: string, label: string): TeamProfile {
  return {
    id,
    tenantId: 'ova',
    label,
    source: 'aes',
    sport: 'indoor',
    kind: 'me',
    aliases: [label],
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
  };
}

function makeWatchingTeam(id: string, label: string): TeamProfile {
  return {
    id,
    tenantId: 'ova',
    label,
    source: 'aes',
    sport: 'indoor',
    kind: 'watching',
    aliases: [label],
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
  };
}

function makeV1(overrides: Partial<UserProfileV1> = {}): UserProfileV1 {
  return {
    version: 1,
    teams: [],
    activeTeamId: null,
    mrsLinked: false,
    cacLinked: false,
    createdAt: FIXED_NOW - 5000,
    updatedAt: FIXED_NOW - 5000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

console.log('Multi-athlete v1 → v2 migration:');

test('one me-team + displayName → self athlete named that displayName, team tagged', () => {
  const v1 = makeV1({
    displayName: 'Sarah',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.version, 2, 'version bumped');
  assertEqual(v2.athletes.length, 1, 'exactly one athlete created');
  const ath = v2.athletes[0];
  assertEqual(ath.displayName, 'Sarah', 'athlete inherits displayName');
  assertEqual(ath.relation, 'self', 'athlete relation is self');
  assertEqual(v2.activeAthleteId, ath.id, 'activeAthleteId points at the new athlete');
  assertEqual(v2.teams.length, 1, 'team count preserved');
  assertEqual(v2.teams[0].athleteId, ath.id, 'me-team tagged with athlete id');
  assertEqual(v2.migratedFromV1At, FIXED_NOW, 'migration timestamp stamped');
});

test('multiple me-teams → all assigned to the same single self athlete', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [
      makeMeTeam('t1', 'Defensa U14'),
      makeMeTeam('t2', 'Pakmen U16'),
      makeMeTeam('t3', 'OVA Provincials'),
    ],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.athletes.length, 1, 'still only one athlete');
  const athleteId = v2.athletes[0].id;
  for (const t of v2.teams) {
    assertEqual(
      t.athleteId,
      athleteId,
      `team ${t.id} tagged with the lone athlete id`
    );
  }
});

test('watching-only → athletes is empty, watching teams have no athleteId', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [
      makeWatchingTeam('w1', 'Toronto Reign'),
      makeWatchingTeam('w2', 'Mississauga Pakmen'),
    ],
    activeTeamId: null,
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.athletes.length, 0, 'no athletes auto-created');
  assertEqual(v2.activeAthleteId, null, 'activeAthleteId is null');
  assertEqual(v2.teams.length, 2, 'watching teams preserved');
  for (const t of v2.teams) {
    assert(
      t.athleteId === undefined,
      `watching team ${t.id} has no athleteId, got ${t.athleteId}`
    );
  }
});

test('mixed me + watching teams → only me-teams get athleteId', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [
      makeMeTeam('t1', 'Defensa U14'),
      makeWatchingTeam('w1', 'Toronto Reign'),
    ],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.athletes.length, 1, 'one athlete');
  const athleteId = v2.athletes[0].id;
  const me = v2.teams.find((t) => t.id === 't1');
  const watching = v2.teams.find((t) => t.id === 'w1');
  assert(me, 'me team present');
  assert(watching, 'watching team present');
  assertEqual(me!.athleteId, athleteId, 'me team tagged');
  assert(watching!.athleteId === undefined, 'watching team untagged');
});

test('no displayName → self athlete named "Me"', () => {
  const v1 = makeV1({
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.athletes.length, 1, 'one athlete');
  assertEqual(v2.athletes[0].displayName, 'Me', 'fallback displayName "Me"');
});

test('role: "coach" → self athlete role is "coach"', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    role: 'coach',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.role, 'coach', 'account-holder role preserved');
  assertEqual(v2.athletes[0].role, 'coach', 'athlete role mapped');
});

test('role: "athlete" → self athlete role is "athlete"', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    role: 'athlete',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assertEqual(v2.athletes[0].role, 'athlete', 'athlete role mapped');
});

test('role: "parent" → self athlete role is undefined (parent isn\'t a per-team role)', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    role: 'parent',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });

  const v2 = buildV2FromV1(v1, FIXED_NOW);

  assert(
    v2.athletes[0].role === undefined,
    `expected undefined, got ${v2.athletes[0].role}`
  );
});

test('re-running migration on a v2 profile is a no-op (short-circuits on version === 2)', () => {
  const v1 = makeV1({
    displayName: 'Sarah',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });
  const v2First = buildV2FromV1(v1, FIXED_NOW);
  // Run again with a different "now" — if it short-circuits, neither
  // updatedAt nor migratedFromV1At should change. Crucially, the athlete
  // id (which is generated from `now`) must NOT be regenerated.
  const v2Second = buildV2FromV1(v2First, FIXED_NOW + 999_999);

  assert(
    v2First === v2Second,
    'identity-equal: same object returned (no-op short-circuit)'
  );
  assertEqual(
    v2Second.athletes[0].id,
    v2First.athletes[0].id,
    'athlete id stable across re-runs'
  );
  assertEqual(
    v2Second.migratedFromV1At,
    FIXED_NOW,
    'migration timestamp not bumped'
  );
});

console.log('\nLook-up helpers (Phase 2 consumers):');

test('getActiveAthlete returns the active athlete', () => {
  const v1 = makeV1({
    displayName: 'Sarah',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);

  const active = getActiveAthlete(v2);
  assert(active != null, 'active athlete returned');
  assertEqual(active!.id, v2.athletes[0].id, 'active is the self athlete');
  assertEqual(active!.displayName, 'Sarah', 'returns full record');
});

test('getActiveAthlete returns null when activeAthleteId is null', () => {
  const v1 = makeV1({
    teams: [makeWatchingTeam('w1', 'Toronto Reign')],
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);
  assertEqual(v2.activeAthleteId, null, 'no active athlete after watching-only migration');
  assertEqual(getActiveAthlete(v2), null, 'helper returns null');
});

test('getActiveAthlete returns null when activeAthleteId points to a missing athlete', () => {
  const v1 = makeV1({
    displayName: 'Sarah',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);
  const danglingAthleteId = 'ath_does_not_exist';
  const tweaked: UserProfile = { ...v2, activeAthleteId: danglingAthleteId };
  assertEqual(getActiveAthlete(tweaked), null, 'dangling id resolves to null');
});

test('getTeamsForAthlete returns only that athlete\'s me-teams', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [
      makeMeTeam('t1', 'Defensa U14'),
      makeMeTeam('t2', 'Pakmen U16'),
      makeWatchingTeam('w1', 'Toronto Reign'),
    ],
    activeTeamId: 't1',
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);
  const athleteId = v2.athletes[0].id;

  const teams = getTeamsForAthlete(v2, athleteId);
  assertEqual(teams.length, 2, 'two me-teams matched');
  assert(teams.every((t) => t.kind === 'me'), 'all matched teams are me-kind');
  const ids = teams.map((t) => t.id).sort();
  assertEqual(ids[0], 't1', 'includes t1');
  assertEqual(ids[1], 't2', 'includes t2');
});

test('getTeamsForAthlete excludes watching teams even if they had a stray athleteId', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);
  const athleteId = v2.athletes[0].id;
  // Inject a hostile watching team carrying a matching athleteId — should
  // still be excluded by the `kind === 'me'` filter.
  const tweaked: UserProfile = {
    ...v2,
    teams: [
      ...v2.teams,
      {
        ...makeWatchingTeam('w1', 'Bad'),
        athleteId,
      },
    ],
  };
  const teams = getTeamsForAthlete(tweaked, athleteId);
  assertEqual(teams.length, 1, 'watching team is filtered out');
  assertEqual(teams[0].id, 't1', 'only the me-team is returned');
});

test('getTeamsForAthlete returns empty array for unknown athlete id', () => {
  const v1 = makeV1({
    displayName: 'Jon',
    teams: [makeMeTeam('t1', 'Defensa U14')],
    activeTeamId: 't1',
  });
  const v2 = buildV2FromV1(v1, FIXED_NOW);
  const teams = getTeamsForAthlete(v2, 'ath_unknown');
  assertEqual(teams.length, 0, 'no teams for unknown athlete');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
