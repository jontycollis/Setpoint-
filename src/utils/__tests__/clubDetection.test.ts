// Tests for the auto-detect club heuristic that runs once during
// migration. Two concerns: the per-label key extraction (extractClubKey)
// and the bucketing pass that turns a TeamProfile[] into a Club[] +
// id-assignments map (detectClubsFromTeams).

import { describe, expect, it } from 'vitest';
import {
  detectClubsFromTeams,
  extractClubKey,
} from '../clubDetection';
import type { TeamProfile } from '../../types/profile';

const FIXED_NOW = 1_700_000_000_000;

function team(id: string, label: string, sport: 'indoor' | 'beach' = 'indoor'): TeamProfile {
  return {
    id,
    tenantId: 'ova',
    label,
    source: 'aes',
    sport,
    kind: 'me',
    aliases: [label],
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
  };
}

describe('extractClubKey', () => {
  it('keeps the leading club token and strips an age-group suffix', () => {
    expect(extractClubKey('PVC 3D Royals U18')).toBe('PVC');
    expect(extractClubKey('PVC Mustangs 16U')).toBe('PVC');
  });

  it('treats slash-separated names as beach pairs (no club)', () => {
    expect(extractClubKey('Collis / Lyevina')).toBeNull();
    expect(extractClubKey('Smith / Jones')).toBeNull();
  });

  it('treats "X and Y" / "X vs Y" as non-club', () => {
    expect(extractClubKey('Collis and Lyevina')).toBeNull();
    expect(extractClubKey('Smith vs Jones')).toBeNull();
    expect(extractClubKey('Smith & Jones')).toBeNull();
  });

  it('falls through generic filler words to find a real club token', () => {
    expect(extractClubKey('Team Reach')).toBe('Reach');
    expect(extractClubKey('The Mustangs')).toBe('Mustangs');
  });

  it('strips gender / division markers from the tail', () => {
    expect(extractClubKey('Defensa Girls U16')).toBe('Defensa');
    expect(extractClubKey('REACH Boys 18U')).toBe('REACH');
  });

  it('returns null for empty / single-char labels', () => {
    expect(extractClubKey('')).toBeNull();
    expect(extractClubKey('   ')).toBeNull();
    expect(extractClubKey('X')).toBeNull();
  });

  it('preserves original casing', () => {
    expect(extractClubKey('pvc 3D Royals U18')).toBe('pvc');
    expect(extractClubKey('REACH U16')).toBe('REACH');
  });
});

describe('detectClubsFromTeams', () => {
  it('buckets multiple teams with the same prefix into one club', () => {
    const teams = [
      team('tp_a', 'PVC 3D Royals U18'),
      team('tp_b', 'PVC Mustangs 16U'),
      team('tp_c', 'Defensa Rob'),
    ];
    const out = detectClubsFromTeams(teams, 'ova', FIXED_NOW);
    expect(out.clubs).toHaveLength(2);
    const pvc = out.clubs.find((c) => c.name === 'PVC');
    const defensa = out.clubs.find((c) => c.name === 'Defensa');
    expect(pvc).toBeDefined();
    expect(defensa).toBeDefined();
    expect(out.assignments['tp_a']).toBe(pvc!.id);
    expect(out.assignments['tp_b']).toBe(pvc!.id);
    expect(out.assignments['tp_c']).toBe(defensa!.id);
  });

  it('stamps tenantId and detectedFromTeamPrefix on every auto-club', () => {
    const teams = [team('tp_a', 'PVC U16')];
    const out = detectClubsFromTeams(teams, 'volleyball-quebec', FIXED_NOW);
    expect(out.clubs[0]!.tenantId).toBe('volleyball-quebec');
    expect(out.clubs[0]!.detectedFromTeamPrefix).toBe(true);
    expect(out.clubs[0]!.createdAt).toBe(FIXED_NOW);
    expect(out.clubs[0]!.updatedAt).toBe(FIXED_NOW);
  });

  it('skips beach pairs and standalone names', () => {
    const teams = [
      team('tp_a', 'Collis / Lyevina', 'beach'),
      team('tp_b', 'PVC U16'),
    ];
    const out = detectClubsFromTeams(teams, 'ova', FIXED_NOW);
    expect(out.clubs).toHaveLength(1);
    expect(out.clubs[0]!.name).toBe('PVC');
    expect(out.assignments['tp_a']).toBeUndefined();
    expect(out.assignments['tp_b']).toBe(out.clubs[0]!.id);
  });

  it('returns empty result when no teams have detectable club keys', () => {
    const teams = [
      team('tp_a', 'Collis / Lyevina', 'beach'),
      team('tp_b', 'Smith and Jones', 'beach'),
    ];
    const out = detectClubsFromTeams(teams, 'ova', FIXED_NOW);
    expect(out.clubs).toHaveLength(0);
    expect(Object.keys(out.assignments)).toHaveLength(0);
  });

  it('produces distinct club ids for clubs detected in the same now', () => {
    const teams = [
      team('tp_a', 'PVC U16'),
      team('tp_b', 'Defensa Rob'),
      team('tp_c', 'REACH Harmony'),
    ];
    const out = detectClubsFromTeams(teams, 'ova', FIXED_NOW);
    const ids = new Set(out.clubs.map((c) => c.id));
    expect(ids.size).toBe(3);
  });
});
