// Tests for the tenant config registry and resolver. Two concerns:
//   1. Registry lookups return the right config for a known id.
//   2. Unknown ids fall back to OVA (the boot default) instead of
//      throwing, so a screen never renders with missing labels.

import { describe, expect, it, vi } from 'vitest';
import { getTenantConfigById, getTenantConfig } from '../index';
import { OVA_TENANT } from '../ova';

describe('getTenantConfigById', () => {
  it("returns the OVA config for id 'ova'", () => {
    const cfg = getTenantConfigById('ova');
    expect(cfg).toBe(OVA_TENANT);
    expect(cfg.shortName).toBe('OVA');
    expect(cfg.rankingsLabel).toBe('OVA Rankings');
    expect(cfg.mrsLabel).toBe('OVA MRS');
  });

  it('falls back to OVA for an unknown id', () => {
    // Silence the __DEV__ warning so the test output stays clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = getTenantConfigById('volleyball-quebec');
    expect(cfg).toBe(OVA_TENANT);
    warn.mockRestore();
  });

  it('logs a console.warn in __DEV__ when falling back', () => {
    // Stub the RN-only __DEV__ global so the dev-warn branch runs in
    // Node. Restore the original value (typically undefined) after.
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      getTenantConfigById('made-up-id');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('made-up-id')
      );
    } finally {
      warn.mockRestore();
      (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    }
  });
});

describe('getTenantConfig', () => {
  it('resolves to the currently-active tenant (OVA today)', () => {
    expect(getTenantConfig()).toBe(OVA_TENANT);
  });

  it("OVA config matches the snapshot of today's user-visible labels", () => {
    // Pinning the OVA labels in a test so an accidental rename here
    // surfaces immediately — these strings are the user-visible UX
    // across the hamburger menu and team badges.
    expect(OVA_TENANT.appBrandName).toBe('Bior');
    expect(OVA_TENANT.displayName).toBe('Ontario Volleyball Association');
    expect(OVA_TENANT.shortName).toBe('OVA');
    expect(OVA_TENANT.rankingsLabel).toBe('OVA Rankings');
    expect(OVA_TENANT.mrsLabel).toBe('OVA MRS');
    expect(OVA_TENANT.aesLabel).toBe('AES');
  });
});
