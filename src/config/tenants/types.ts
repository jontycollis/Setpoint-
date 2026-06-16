// ── Tenant configuration types ────────────────────────────────────────────
//
// White-label foundation: every piece of user-facing OVA branding that
// would need to change for resale (to Volleyball Quebec, an NCAA
// conference, a club, etc.) lives in a TenantConfig. The runtime reads
// the current tenant id (via getCurrentTenantId from utils/tenant) and
// resolves the matching config through the registry in ./index.
//
// Adding a new tenant:
//   1. Define a TenantConfig literal in ./<id>.ts (mirror ./ova.ts)
//   2. Register it in the REGISTRY map in ./index.ts
//   3. Decide how the tenant id gets set at boot (build flag,
//      remote-config bootstrap, etc.) — this module doesn't care.
//
// What's intentionally NOT in TenantConfig:
//   • Theme colors — the existing ThemeContext owns those, swapping
//     primary colors per tenant is a follow-up. Set `colors.primary`
//     here as a hint; renderers can opt in.
//   • Feature flags — separate concern (a tenant might be on the same
//     codebase with the same rev but different feature toggles).
//   • API base URLs — those live in api/ clients and key off env.
//
// All fields are required so a new tenant can't accidentally ship with
// missing labels. Optional fields are restricted to true add-ons
// (rankings module URL, beach module presence, etc.).
// ──────────────────────────────────────────────────────────────────────────

export interface TenantConfig {
  /** Stable id; must match the tenantId stamped on records. */
  id: string;

  /** Branding / display ----------------------------------------------- */

  /** Full org name. "Ontario Volleyball Association". */
  displayName: string;
  /** Short / acronym form. "OVA". Used in chip labels, badges. */
  shortName: string;
  /** Brand name for the app when distributed under this tenant. May
   *  differ from displayName when the org licenses the platform under
   *  their own product brand. */
  appBrandName: string;

  /** Hard module references ------------------------------------------- */

  /** Display label for the rankings module (e.g. "OVA Rankings"). */
  rankingsLabel: string;
  /** Display label for the member registration system (e.g. "OVA MRS"). */
  mrsLabel: string;
  /** Display label for the AES tournament platform integration. AES is
   *  org-agnostic; today the label is just "AES" but tenants may want
   *  to brand it locally. */
  aesLabel: string;

  /** Outbound links --------------------------------------------------- */
  links: {
    /** Marketing / org website. */
    website?: string;
    /** Direct deep-link to the rankings module. */
    rankings?: string;
    /** Direct deep-link to MRS sign-in. */
    mrs?: string;
  };

  /** Theme hints (advisory — renderers opt in) ------------------------ */
  colors?: {
    /** Optional override for the app primary color. When set, theming
     *  callers can lean on this for tenant-specific accent. Default
     *  ThemeContext primary stays as the fallback. */
    primary?: string;
  };
}
