// ── Court-filter chips ─────────────────────────────────────────────────────
//
// Derives the unique court list shown above the court schedule. Pure —
// tests pin the natural-sort behaviour ("Court 10" lands after "Court 2",
// not after "Court 1") so a regression can't ship a 1, 10, 11, …, 2, 20
// ordering on tournaments like BMO Centre Calgary Nationals (56 courts).
// ──────────────────────────────────────────────────────────────────────────

export interface CourtChipMatch {
  CourtName?: string;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function buildCourtList(matches: readonly CourtChipMatch[]): string[] {
  const seen = new Set<string>();
  for (const m of matches) {
    const name = (m.CourtName || '').trim();
    if (name) seen.add(name);
  }
  return Array.from(seen).sort((a, b) => collator.compare(a, b));
}
