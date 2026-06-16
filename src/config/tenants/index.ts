// ── Tenant config resolver ────────────────────────────────────────────────
//
// One entry point: `getTenantConfig()`. Reads the current tenant id from
// `utils/tenant.getCurrentTenantId()` and returns the matching
// TenantConfig. Falls back to OVA when an unknown id is encountered,
// because shipping a screen with empty labels would be worse than
// showing OVA defaults — and the boot-time `getCurrentTenantId()` only
// returns 'ova' today regardless.
//
// Adding a tenant: import its config, register it in REGISTRY.
//
// Design notes:
//   • No caching — the resolver is cheap and the active id is a
//     constant today. When a future "switch organisation" flow lands,
//     callers will need to re-render anyway.
//   • Lookups by id, not by an inferred default, so a typo in the
//     tenant id surfaces immediately instead of silently routing to OVA.
// ──────────────────────────────────────────────────────────────────────────

import { getCurrentTenantId } from '../../utils/tenant';
import type { TenantConfig } from './types';
import { OVA_TENANT } from './ova';

export type { TenantConfig } from './types';

const REGISTRY: Record<string, TenantConfig> = {
  [OVA_TENANT.id]: OVA_TENANT,
};

/**
 * Resolve a TenantConfig by id. Use when you have a specific tenantId
 * (e.g. iterating over a multi-tenant data set). Most UI callers want
 * `getTenantConfig()` below.
 *
 * Returns the OVA fallback for unknown ids so a screen never renders
 * with empty labels. Logs in __DEV__ so an unintended fallback is
 * visible during development.
 */
export function getTenantConfigById(tenantId: string): TenantConfig {
  const hit = REGISTRY[tenantId];
  if (hit) return hit;
  // __DEV__ is a React Native build-time constant; guard with typeof so
  // this module also works when imported under Node (tests, scripts).
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      `[tenants] no config for tenantId "${tenantId}" — using OVA fallback`
    );
  }
  return OVA_TENANT;
}

/**
 * Resolve the TenantConfig for the currently-active tenant. Standard
 * UI call shape — pair this with `useTenant()` (hook) once a future
 * dynamic-tenant flow needs reactive switching.
 */
export function getTenantConfig(): TenantConfig {
  return getTenantConfigById(getCurrentTenantId());
}

/**
 * Lightweight hook wrapper. Returns the active TenantConfig. Equivalent
 * to `getTenantConfig()` today because the active id is a constant; the
 * hook form exists so when reactive tenant switching arrives, callers
 * don't need to re-import. Renders never have to memo this — it's the
 * same object reference between calls.
 */
export function useTenantConfig(): TenantConfig {
  return getTenantConfig();
}
