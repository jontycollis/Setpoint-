// Tests for the MyTeam.Click season-index projection. AsyncStorage is
// mocked at module level so the storage helpers work under Node.
//
// Coverage:
//   • detectSportFromGroups — beach default, indoor markers, 2x2/2s/beach
//   • buildMtcSnapshotFromSchedule — basic shape, dateMs parse, sport flag
//   • snapshotToUnifiedEntries — finds player's team, projects fields
//   • partner extraction from 2x2 slot data
//   • field size = team count in the group
//   • finalRankLabel ordinal formatting
//   • multi-group player (16U + 18U) yields two unified entries
//   • match record derives from matchList when team rollup is absent

import { describe, expect, it, vi, beforeEach } from 'vitest';

const memory: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => memory[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      memory[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete memory[k];
    }),
  },
}));

import {
  buildMtcSnapshotFromSchedule,
  detectSportFromGroups,
  loadMtcSeasonIndex,
  removeMtcSnapshot,
  saveMtcSnapshot,
  snapshotToUnifiedEntries,
  sortedMtcSnapshots,
  type MtcEventSnapshot,
} from '../myteamClickSeasonIndex';
import type {
  MtcGroup,
  MtcMatch,
  MtcScheduleResponse,
} from '../../api/myteamClickClient';

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
});

// ── detectSportFromGroups ──────────────────────────────────────────────────

describe('detectSportFromGroups', () => {
  it('returns "beach" for 2x2 / 2s / beach group names', () => {
    expect(detectSportFromGroups([{ name: '2x2 Women Open' }])).toBe('beach');
    expect(
      detectSportFromGroups([{ name: "Top Guns - Men's 2s Open" }])
    ).toBe('beach');
    expect(detectSportFromGroups([{ name: 'Beach Doubles A' }])).toBe('beach');
  });

  it('returns "indoor" when a group name mentions 6s / coed 6 / league night', () => {
    expect(detectSportFromGroups([{ name: 'Co-ed 6 League' }])).toBe('indoor');
    expect(detectSportFromGroups([{ name: 'League Night A' }])).toBe('indoor');
    expect(detectSportFromGroups([{ name: 'Men 6s Open' }])).toBe('indoor');
  });

  it('defaults to "beach" when no marker matches', () => {
    expect(detectSportFromGroups([{ name: 'Generic Division' }])).toBe('beach');
    expect(detectSportFromGroups([])).toBe('beach');
  });

  it('indoor markers win over beach markers in mixed events', () => {
    expect(
      detectSportFromGroups([
        { name: '2x2 Women Open' },
        { name: 'Co-ed 6 Mixed' },
      ])
    ).toBe('indoor');
  });
});

// ── Test fixtures ──────────────────────────────────────────────────────────

const MY_ID = '6699665202d4e2634939d1e7';

function partner(): { firstName: string; lastName: string; _id: string } {
  return {
    firstName: 'K.',
    lastName: 'McKeil',
    _id: '669966f702d4e2634939f1e6',
  };
}

function group2x2(
  opts: {
    name?: string;
    myTeamId?: string;
    finalPos?: number;
    poolPos?: number;
    mWon?: number;
    mLost?: number;
    sWon?: number;
    sLost?: number;
    fieldSize?: number;
    omitMeFromTeam?: boolean;
  } = {}
): MtcGroup {
  const myTeamId = opts.myTeamId ?? '69e23d3233542897bfffe5a2';
  const slots = opts.omitMeFromTeam
    ? [partner()]
    : [
        { firstName: 'A.', lastName: 'Collis', _id: MY_ID },
        partner(),
      ];
  const teams = Array.from({ length: opts.fieldSize ?? 8 }, (_, i) => ({
    _id: i === 0 ? myTeamId : `team_${i}`,
    name: i === 0 ? 'A.Collis/K.McKeil' : `Team ${i}`,
    state: 2,
    slots:
      i === 0
        ? slots
        : [
            {
              firstName: `Player${i}A`,
              lastName: 'X',
              _id: `p_${i}_a`,
            },
            {
              firstName: `Player${i}B`,
              lastName: 'Y',
              _id: `p_${i}_b`,
            },
          ],
    no: i + 1,
    groupPos: i === 0 ? opts.finalPos : undefined,
    poolPos: i === 0 ? opts.poolPos : undefined,
    mWon: i === 0 ? opts.mWon : undefined,
    mLost: i === 0 ? opts.mLost : undefined,
    sWon: i === 0 ? opts.sWon : undefined,
    sLost: i === 0 ? opts.sLost : undefined,
  })) as MtcGroup['teams'];
  return {
    _id: opts.name ?? 'group_a',
    name: opts.name ?? '2x2 Girls 16U',
    teams,
    poolPlay: { useMatchesWon: true, poolList: [] },
    challenge: { matchRefList: [] },
    finals: {
      initMethod: 'MINI_X',
      orderBy: 'groupPos',
      applyCP: true,
      state: 0,
      treeList: [],
    },
  };
}

function schedule(opts: {
  eventId?: string;
  eventName?: string;
  date?: string;
  venue?: string;
  groups: MtcGroup[];
  matchList?: MtcMatch[];
}): MtcScheduleResponse {
  return {
    success: true,
    org: { _id: 'org_1', name: 'Helix Volley', timeZone: 'America/Toronto' },
    customConfig: {},
    timeZone: 'America/Toronto',
    adminLevel: 0,
    event: {
      _id: opts.eventId ?? '66994f7602d4e26349371d2a',
      name: opts.eventName ?? 'Gold - Toronto - July 20 - 16U',
      date: opts.date ?? '2024-07-20T13:30:00.000Z',
      timeFrames: [
        { start: opts.date ?? '2024-07-20T13:30:00.000Z', end: '2024-07-21T00:00:00.000Z' },
      ],
      orgRef: { name: 'Helix Volley', org: 'org_1', abbr: 'Helix' },
      locList: [
        opts.venue
          ? { _id: 'loc_1', name: opts.venue }
          : { _id: 'loc_1', name: 'Ashbridge’s Bay' },
      ],
      courtDef: [],
      groups: opts.groups,
      matchList: opts.matchList ?? [],
    },
  };
}

// ── buildMtcSnapshotFromSchedule ───────────────────────────────────────────

describe('buildMtcSnapshotFromSchedule', () => {
  it('captures the basic event fields + parses dateMs', () => {
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({ groups: [group2x2()] }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
      indexedAt: 1_700_000_000_000,
    });
    expect(snap.eventName).toBe('Gold - Toronto - July 20 - 16U');
    expect(snap.dateMs).toBe(Date.parse('2024-07-20T13:30:00.000Z'));
    expect(snap.sport).toBe('beach');
    expect(snap.orgName).toBe('Helix Volley');
    expect(snap.venueName).toMatch(/Ashbridge/);
    expect(snap.indexedAt).toBe(1_700_000_000_000);
  });

  it('flags an event as indoor when groups mention 6s', () => {
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({
        groups: [{ ...group2x2(), name: 'Co-ed 6 Mixed' }],
      }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
    });
    expect(snap.sport).toBe('indoor');
  });
});

// ── snapshotToUnifiedEntries ───────────────────────────────────────────────

describe('snapshotToUnifiedEntries', () => {
  it('finds the player’s team and projects the basic fields', () => {
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({
        groups: [
          group2x2({
            fieldSize: 12,
            finalPos: 3,
            mWon: 4,
            mLost: 1,
            sWon: 9,
            sLost: 3,
          }),
        ],
      }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
    });
    const entries = snapshotToUnifiedEntries(snap);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.source).toBe('myteamclick');
    expect(e.sport).toBe('beach');
    expect(e.tournamentName).toBe('Gold - Toronto - July 20 - 16U');
    expect(e.subtitle).toBe('2x2 Girls 16U');
    expect(e.finalRank).toBe(3);
    expect(e.finalRankLabel).toBe('3rd');
    expect(e.fieldSize).toBe(12);
    expect(e.matchesFor).toBe(4);
    expect(e.matchesAgainst).toBe(1);
    expect(e.setsFor).toBe(9);
    expect(e.setsAgainst).toBe(3);
    expect(e.beachPartner?.name).toBe('K. McKeil');
    expect(e.myTeamAsSeen).toBe('A.Collis/K.McKeil');
  });

  it('returns an empty list when the player isn’t on any team', () => {
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({ groups: [group2x2({ omitMeFromTeam: true })] }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
    });
    const entries = snapshotToUnifiedEntries(snap);
    expect(entries).toEqual([]);
  });

  it('yields one entry per group when the player is in multiple groups', () => {
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({
        groups: [
          {
            ...group2x2({ name: '2x2 Girls 16U', finalPos: 3 }),
            _id: 'g_16u',
            name: '2x2 Girls 16U',
          },
          {
            ...group2x2({ name: '2x2 Girls 18U', finalPos: 5 }),
            _id: 'g_18u',
            name: '2x2 Girls 18U',
          },
        ],
      }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
    });
    const entries = snapshotToUnifiedEntries(snap);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.subtitle).sort()).toEqual([
      '2x2 Girls 16U',
      '2x2 Girls 18U',
    ]);
  });

  it('derives match record from matchList when the team rollup is empty', () => {
    const myTeamId = 'team_me';
    const groups: MtcGroup[] = [
      {
        ...group2x2(),
        teams: [
          {
            _id: myTeamId,
            name: 'A.Collis/K.McKeil',
            state: 2,
            slots: [
              { firstName: 'A.', lastName: 'Collis', _id: MY_ID },
              partner(),
            ],
            // No m/sWon fields — forces matchList derivation.
          },
          { _id: 'opp_1', name: 'Opp 1', state: 2, slots: [] } as never,
          { _id: 'opp_2', name: 'Opp 2', state: 2, slots: [] } as never,
        ],
      },
    ];
    const matchList: MtcMatch[] = [
      {
        _id: 1,
        type: 'P',
        state: 2,
        teams: [
          { teamId: myTeamId, scores: [21, 21] },
          { teamId: 'opp_1', scores: [15, 11] },
        ],
      },
      {
        _id: 2,
        type: 'P',
        state: 2,
        teams: [
          { teamId: myTeamId, scores: [19, 18] },
          { teamId: 'opp_2', scores: [21, 21] },
        ],
      },
    ];
    const snap = buildMtcSnapshotFromSchedule({
      response: schedule({ groups, matchList }),
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
    });
    const entries = snapshotToUnifiedEntries(snap);
    expect(entries[0]!.matchesFor).toBe(1);
    expect(entries[0]!.matchesAgainst).toBe(1);
    expect(entries[0]!.setsFor).toBe(2);
    expect(entries[0]!.setsAgainst).toBe(2);
    expect(entries[0]!.matches).toHaveLength(2);
    expect(entries[0]!.matches[0]!.opponentName).toBe('Opp 1');
  });
});

// ── Storage layer ──────────────────────────────────────────────────────────

describe('MyTeam.Click season-index storage', () => {
  function snap(
    overrides: Partial<MtcEventSnapshot> = {}
  ): MtcEventSnapshot {
    return {
      source: 'myteamclick',
      eventId: overrides.eventId ?? 'ev_a',
      myPlayerId: MY_ID,
      myPlayerName: { firstName: 'A.', lastName: 'Collis' },
      eventName: 'Test',
      dateText: '2024-07-20T13:30:00.000Z',
      dateMs: Date.parse('2024-07-20T13:30:00.000Z'),
      sport: 'beach',
      groups: [],
      matchList: [],
      locList: [],
      indexedAt: 1_700_000_000_000,
      ...overrides,
    };
  }

  it('persists and reads back a snapshot', async () => {
    await saveMtcSnapshot(snap({ eventId: 'ev_a' }));
    const idx = await loadMtcSeasonIndex();
    expect(idx['ev_a']).toBeDefined();
    expect(idx['ev_a']!.myPlayerId).toBe(MY_ID);
  });

  it('replaces an existing snapshot keyed by eventId', async () => {
    await saveMtcSnapshot(snap({ eventId: 'ev_a', eventName: 'V1' }));
    await saveMtcSnapshot(snap({ eventId: 'ev_a', eventName: 'V2' }));
    const idx = await loadMtcSeasonIndex();
    expect(Object.keys(idx)).toEqual(['ev_a']);
    expect(idx['ev_a']!.eventName).toBe('V2');
  });

  it('removes a snapshot', async () => {
    await saveMtcSnapshot(snap({ eventId: 'ev_a' }));
    await saveMtcSnapshot(snap({ eventId: 'ev_b' }));
    await removeMtcSnapshot('ev_a');
    const idx = await loadMtcSeasonIndex();
    expect(Object.keys(idx).sort()).toEqual(['ev_b']);
  });

  it('sorts snapshots newest-first by dateMs', async () => {
    await saveMtcSnapshot(snap({ eventId: 'old', dateMs: 1000 }));
    await saveMtcSnapshot(snap({ eventId: 'new', dateMs: 9000 }));
    await saveMtcSnapshot(snap({ eventId: 'mid', dateMs: 5000 }));
    const sorted = sortedMtcSnapshots(await loadMtcSeasonIndex());
    expect(sorted.map((s) => s.eventId)).toEqual(['new', 'mid', 'old']);
  });
});
