// ── Beach tournament discovery ────────────────────────────────────────────
//
// Pure helpers for the MyTeam.Click search-by-area discovery flow (#5).
// Wraps the network call (`searchTournamentsByArea`) with a projection
// that turns the raw `MtcSearchResponse` into a `DiscoveredTournament[]`
// the UI can render directly: org name resolved, location resolved,
// sport classified (beach vs indoor), groups + capacity formatted.
//
// Keeping the projection pure (and the network call passed in) means
// the UI surface that renders the "Discover beach tournaments" screen
// can write straightforward tests without mocking fetch.
// ──────────────────────────────────────────────────────────────────────────

import type {
  MtcSearchEventEntry,
  MtcSearchResponse,
  MtcSearchArea,
  MyTeamClickSession,
} from '../api/myteamClickClient';
import { searchTournamentsByArea } from '../api/myteamClickClient';
import { detectSportFromGroups } from './myteamClickSeasonIndex';

export interface DiscoveredTournamentGroup {
  name: string;
  maxTeams: number;
  registeredCount: number;
  waitlistCount: number;
  /** True when registrations are full (active + waitlist active). */
  isFull: boolean;
}

/**
 * A tournament returned from area discovery, in display-ready shape.
 * Renderer just maps these onto cards / list rows.
 */
export interface DiscoveredTournament {
  /** Event id — used for follow-up indexing via `fetchEventSchedule`. */
  eventId: string;
  /** Stable url key for routing (mirrors the SPA's deep link format). */
  tournamentName: string;
  /** Organising org's display name (e.g. "Helix Volley"). */
  orgName: string;
  /** Resolved venue. May be empty if the event has no locList. */
  venueName: string;
  /** Province / state when present (driven by locList). */
  stateProv?: string;
  /** Sport classification inferred from group names. */
  sport: 'indoor' | 'beach';
  /** First event date (ISO). */
  dateText: string;
  /** ms epoch of the event start. */
  dateMs: number;
  /** Distance from the search center as the API reports it. Units
   *  unclear from the probe — treat as a relative measure. */
  distance: number;
  /** Per-division summary. */
  groups: DiscoveredTournamentGroup[];
  /** Total registered teams across every group. */
  totalRegistered: number;
  /** Total capacity across every group. */
  totalCapacity: number;
  /** Earliest registration-open date (ISO). Undefined when none. */
  regStartDate?: string;
  /** True when the event was canceled by the organizer. */
  canceled: boolean;
}

/**
 * Project a single MtcSearchEventEntry into the display shape. Resolves
 * `orgId` against the supplied org dictionary and `locList[0]` against
 * the supplied location dictionary — same pattern the SPA uses on its
 * search screen.
 */
export function projectSearchEntry(
  entry: MtcSearchEventEntry,
  orgList: MtcSearchResponse['orgList'],
  locList: MtcSearchResponse['locList']
): DiscoveredTournament {
  const org = orgList.find((o) => o._id === entry.event.orgId);
  const firstLocRef = entry.event.locList[0];
  const loc = firstLocRef
    ? locList.find((l) => l._id === firstLocRef._id)
    : undefined;
  const groups: DiscoveredTournamentGroup[] = entry.event.groups.map((g) => ({
    name: g.name,
    maxTeams: g.maxTeams,
    registeredCount: g.stateCount?.act ?? 0,
    waitlistCount: g.stateCount?.wl ?? 0,
    isFull:
      (g.stateCount?.act ?? 0) >= g.maxTeams &&
      !((g.wlActive ?? false) && (g.stateCount?.wl ?? 0) < g.maxTeams),
  }));
  const totalRegistered = groups.reduce((n, g) => n + g.registeredCount, 0);
  const totalCapacity = groups.reduce((n, g) => n + g.maxTeams, 0);
  const earliestReg = (entry.event.regStartDates ?? []).reduce<
    string | undefined
  >((acc, r) => {
    if (!r?.date) return acc;
    if (!acc) return r.date;
    return Date.parse(r.date) < Date.parse(acc) ? r.date : acc;
  }, undefined);
  return {
    eventId: entry.event._id,
    tournamentName: entry.event.name,
    orgName: org?.name ?? 'Unknown organizer',
    venueName: loc?.name ?? '',
    stateProv: loc?.stateProv,
    sport: detectSportFromGroups(entry.event.groups),
    dateText: entry.event.date,
    dateMs: Date.parse(entry.event.date),
    distance: entry.loc.distance,
    groups,
    totalRegistered,
    totalCapacity,
    regStartDate: earliestReg,
    canceled: entry.event.states?.canceled === true,
  };
}

/**
 * Project a full MtcSearchResponse into the display list. Sorted by
 * date (earliest first — discovery is forward-looking). Canceled
 * events stay in the list so the renderer can show them muted; UI
 * decides whether to filter them out.
 */
export function projectSearchResponse(
  response: MtcSearchResponse
): DiscoveredTournament[] {
  return response.eventList
    .map((entry) =>
      projectSearchEntry(entry, response.orgList, response.locList)
    )
    .sort((a, b) => a.dateMs - b.dateMs);
}

/**
 * End-to-end discovery: run the search, filter by sport, return a
 * display-ready list. Defaults to beach-only, which is the headline
 * use case (every other sport surface in Bior has its own discovery
 * flow).
 */
export async function discoverBeachTournaments(args: {
  session: MyTeamClickSession;
  searchArea: MtcSearchArea;
  afterDate?: Date;
  /** Set to 'all' to include indoor (rare on MyTeam.Click), 'beach'
   *  (default) to filter, or 'indoor' for the inverse. */
  sport?: 'beach' | 'indoor' | 'all';
}): Promise<DiscoveredTournament[]> {
  const response = await searchTournamentsByArea(args.session, {
    searchArea: args.searchArea,
    afterDate: args.afterDate ?? new Date(),
  });
  if (response.success === false) return [];
  const projected = projectSearchResponse(response);
  const sport = args.sport ?? 'beach';
  if (sport === 'all') return projected;
  return projected.filter((t) => t.sport === sport);
}
