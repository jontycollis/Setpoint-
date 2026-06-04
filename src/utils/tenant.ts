// ── Tenant configuration ───────────────────────────────────────────────────
//
// White-label / multi-tenant foundation. Every data record carries a
// `tenantId` so that:
//
//   • Bior can ship as the OVA member experience today.
//   • Tomorrow, the same codebase can be configured for Volleyball
//     Quebec, NCAA conference X, or any PSO that licenses the platform
//     without touching the data model.
//   • When the OVA backend lands, records sync to the right org slice.
//
// This module is intentionally tiny. The active tenant ID is a single
// constant resolved at boot. A future task (#13: white-label config
// layer) will replace this with a real runtime config object that's
// loaded from a per-build config file or remote bootstrap.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The tenant ID stamped on records the app creates locally when no
 * other context says otherwise. Today every Bior install belongs to
 * the OVA tenant — Bior is shipping OVA-first. When a user is later
 * connected to a different tenant (a future "Connect organisation"
 * flow), records they create in that context will carry that tenant's
 * ID instead. This constant is the boot default.
 *
 * NEVER hardcode `'ova'` elsewhere in the codebase. Import this.
 */
export const DEFAULT_TENANT_ID = 'ova';

/**
 * Returns the tenant ID for newly-created records. Today this is just
 * `DEFAULT_TENANT_ID`; the function form exists so that when the
 * white-label config layer lands (task #13), callers don't need to
 * change — the resolution logic moves inside this function.
 */
export function getCurrentTenantId(): string {
  return DEFAULT_TENANT_ID;
}
