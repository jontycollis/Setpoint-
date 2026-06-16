// Tests for the beach-discovery projection. Pure helpers only — no
// network dependency. Covers org/loc resolution, sport classification,
// regStartDate selection, capacity rollups, isFull semantics.

import { describe, expect, it } from 'vitest';
import {
  projectSearchEntry,
  projectSearchResponse,
} from '../beachDiscovery';
import type {
  MtcSearchEventEntry,
  MtcSearchResponse,
} from '../../api/myteamClickClient';

function entry(
  overrides: Partial<MtcSearchEventEntry['event']> = {},
  locOverrides: Partial<MtcSearchEventEntry['loc']> = {}
): MtcSearchEventEntry {
  return {
    loc: { distance: 5534, _id: 'loc_a', ...locOverrides },
    event: {
      _id: 'ev_a',
      orgId: 'org_helix',
      name: 'Helix Havoc',
      date: '2026-07-11T13:00:00.000Z',
      timeFrames: [
        { start: '2026-07-11T13:00:00.000Z', end: '2026-07-11T21:00:00.000Z' },
      ],
      states: { canceled: false },
      displaySettings: {},
      regStartDates: [
        { date: '2026-04-10T16:58:56.205Z', code: '' },
      ],
      groups: [
        {
          name: "Top Guns - Men's 2s Open",
          maxTeams: 16,
          wlActive: false,
          stateCount: { act: 5, wl: 0 },
        },
        {
          name: "Sirens - Women's 2s Open",
          maxTeams: 16,
          wlActive: false,
          stateCount: { act: 16, wl: 2 },
        },
      ],
      locList: [{ _id: 'loc_a' }],
      ...overrides,
    },
  };
}

function response(
  entries: MtcSearchEventEntry[] = [entry()]
): MtcSearchResponse {
  return {
    success: true,
    serverDate: 1_780_000_000_000,
    orgList: [
      { _id: 'org_helix', name: 'Helix Volley', abbr: 'Helix' },
      { _id: 'org_jnp', name: 'JNP Memorial Tournament', abbr: 'JNP' },
    ],
    locList: [
      { _id: 'loc_a', name: "Ashbridge's Bay", stateProv: 'Ontario' },
      { _id: 'loc_b', name: "Bingeman's", stateProv: 'Ontario', city: 'Kitchener' },
    ],
    eventList: entries,
  };
}

describe('projectSearchEntry', () => {
  it('resolves orgId → org name and locList[0] → venue name', () => {
    const r = response();
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.orgName).toBe('Helix Volley');
    expect(p.venueName).toBe("Ashbridge's Bay");
    expect(p.stateProv).toBe('Ontario');
  });

  it('classifies an event with 2s groups as beach', () => {
    const r = response();
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.sport).toBe('beach');
  });

  it('classifies events with co-ed 6 / 6s markers as indoor', () => {
    const r = response([
      entry({
        groups: [
          {
            name: 'Co-ed 6',
            maxTeams: 11,
            wlActive: false,
            stateCount: { act: 6, wl: 0 },
          },
        ],
      }),
    ]);
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.sport).toBe('indoor');
  });

  it('sums totalRegistered + totalCapacity across groups', () => {
    const r = response();
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.totalCapacity).toBe(32);
    expect(p.totalRegistered).toBe(21);
  });

  it('flags a group as full when active hits maxTeams and waitlist is off', () => {
    const r = response();
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    const sirens = p.groups.find((g) => g.name.includes('Sirens'))!;
    expect(sirens.isFull).toBe(true);
    const topGuns = p.groups.find((g) => g.name.includes('Top Guns'))!;
    expect(topGuns.isFull).toBe(false);
  });

  it('treats a group as NOT full when waitlist is active with room', () => {
    const r = response([
      entry({
        groups: [
          {
            name: '2x2 Women Open',
            maxTeams: 16,
            wlActive: true,
            stateCount: { act: 16, wl: 5 },
          },
        ],
      }),
    ]);
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.groups[0]!.isFull).toBe(false);
  });

  it('selects the earliest regStartDate when multiple are present', () => {
    const r = response([
      entry({
        regStartDates: [
          { date: '2026-04-10T00:00:00.000Z', code: 'early' },
          { date: '2026-03-01T00:00:00.000Z', code: 'organizer' },
          { date: '2026-05-15T00:00:00.000Z', code: 'public' },
        ],
      }),
    ]);
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.regStartDate).toBe('2026-03-01T00:00:00.000Z');
  });

  it('carries the canceled flag through', () => {
    const r = response([entry({ states: { canceled: true } })]);
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.canceled).toBe(true);
  });

  it('falls back to "Unknown organizer" when orgId doesn’t resolve', () => {
    const r = response([entry({ orgId: 'org_missing' })]);
    const p = projectSearchEntry(r.eventList[0]!, r.orgList, r.locList);
    expect(p.orgName).toBe('Unknown organizer');
  });
});

describe('projectSearchResponse', () => {
  it('sorts entries earliest-first by dateMs', () => {
    const r = response([
      entry({ _id: 'late', date: '2026-09-01T00:00:00.000Z' }),
      entry({ _id: 'early', date: '2026-06-01T00:00:00.000Z' }),
      entry({ _id: 'mid', date: '2026-07-15T00:00:00.000Z' }),
    ]);
    const projected = projectSearchResponse(r);
    expect(projected.map((p) => p.eventId)).toEqual(['early', 'mid', 'late']);
  });
});
