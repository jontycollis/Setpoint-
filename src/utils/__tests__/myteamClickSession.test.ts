// Tests for the MyTeam.Click session helpers. Pure functions + an
// AsyncStorage-mocked CRUD path.

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
  loadMyTeamClickSession,
  saveMyTeamClickSession,
  clearMyTeamClickSession,
  parseCapturedUserBlob,
  shouldSuggestRelink,
} from '../myteamClickSession';

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
});

const FIXED_NOW = 1_700_000_000_000;

describe('parseCapturedUserBlob', () => {
  it('extracts JWT + player id + name from the WebView blob', () => {
    const raw = JSON.stringify({
      token: 'jwt_value',
      _id: 'player_abc',
      firstName: 'Abby',
      lastName: 'Collis',
    });
    const out = parseCapturedUserBlob(raw, FIXED_NOW);
    expect(out).toEqual({
      jwt: 'jwt_value',
      playerId: 'player_abc',
      firstName: 'Abby',
      lastName: 'Collis',
      linkedAtMs: FIXED_NOW,
    });
  });

  it('returns null when token is missing or empty', () => {
    expect(parseCapturedUserBlob(JSON.stringify({ _id: 'x' }))).toBeNull();
    expect(
      parseCapturedUserBlob(JSON.stringify({ token: '', _id: 'x' }))
    ).toBeNull();
  });

  it('returns null when _id is missing or empty', () => {
    expect(parseCapturedUserBlob(JSON.stringify({ token: 'x' }))).toBeNull();
    expect(
      parseCapturedUserBlob(JSON.stringify({ token: 'x', _id: '' }))
    ).toBeNull();
  });

  it('tolerates missing names', () => {
    const out = parseCapturedUserBlob(
      JSON.stringify({ token: 't', _id: 'p' }),
      FIXED_NOW
    );
    expect(out).toEqual({
      jwt: 't',
      playerId: 'p',
      firstName: '',
      lastName: '',
      linkedAtMs: FIXED_NOW,
    });
  });

  it('returns null on malformed JSON', () => {
    expect(parseCapturedUserBlob('not json')).toBeNull();
    expect(parseCapturedUserBlob('null')).toBeNull();
    expect(parseCapturedUserBlob('[]')).toBeNull();
  });
});

describe('shouldSuggestRelink', () => {
  it('is false for a record under 90 days old', () => {
    const record = {
      jwt: 'j',
      playerId: 'p',
      firstName: '',
      lastName: '',
      linkedAtMs: FIXED_NOW - 30 * 86400_000,
    };
    expect(shouldSuggestRelink(record, FIXED_NOW)).toBe(false);
  });

  it('is true once the record passes 90 days', () => {
    const record = {
      jwt: 'j',
      playerId: 'p',
      firstName: '',
      lastName: '',
      linkedAtMs: FIXED_NOW - 100 * 86400_000,
    };
    expect(shouldSuggestRelink(record, FIXED_NOW)).toBe(true);
  });
});

describe('save / load / clear', () => {
  const record = {
    jwt: 'jwt_value',
    playerId: 'player_abc',
    firstName: 'Abby',
    lastName: 'Collis',
    linkedAtMs: FIXED_NOW,
  };

  it('persists and reads back the record', async () => {
    await saveMyTeamClickSession(record);
    const loaded = await loadMyTeamClickSession();
    expect(loaded).toEqual(record);
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadMyTeamClickSession()).toBeNull();
  });

  it('returns null when stored value is missing required fields', async () => {
    memory['@bior/myteamclick-session/v1'] = JSON.stringify({
      jwt: '',
      playerId: 'p',
      linkedAtMs: FIXED_NOW,
    });
    expect(await loadMyTeamClickSession()).toBeNull();
  });

  it('clears the record', async () => {
    await saveMyTeamClickSession(record);
    await clearMyTeamClickSession();
    expect(await loadMyTeamClickSession()).toBeNull();
  });
});
