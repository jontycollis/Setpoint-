// ── OVA tenant config ─────────────────────────────────────────────────────
//
// The Bior-as-OVA-experience default. Matches what users see today;
// changing strings here changes them everywhere the tenant config is
// consumed.
// ──────────────────────────────────────────────────────────────────────────

import type { TenantConfig } from './types';

export const OVA_TENANT: TenantConfig = {
  id: 'ova',
  displayName: 'Ontario Volleyball Association',
  shortName: 'OVA',
  appBrandName: 'Bior',
  rankingsLabel: 'OVA Rankings',
  mrsLabel: 'OVA MRS',
  aesLabel: 'AES',
  links: {
    website: 'https://ontariovolleyball.org/',
    rankings: 'https://ontariovolleyball.org/rankings/',
    mrs: 'https://ontariovolleyball.org/mrs/',
  },
};
