// Tournament registry — maps Country → Tournament → Year → AES event keys
// Add new tournaments/years here as they become available on AES.

export interface TournamentEvent {
  key: string;
  label: string;
  subtitle: string;
  dates: string;
  venue?: string;
  venueMapUrl?: string;
  /** URL to the competition info page (e.g. volleyball.ca city page) */
  infoPageUrl?: string;
}

/** Standalone venue map not tied to a specific AES event. Useful when:
 *   - Maps are published before AES has indexed the corresponding
 *     events (e.g. 2026 Nationals Calgary — maps live, AES keys TBD)
 *   - A venue hosts multiple sub-tournaments under one umbrella so
 *     one AES event would need to point at multiple maps */
export interface ExtraVenueMap {
  /** Display label on the card (e.g. "Calgary — Tournament 1"). */
  label: string;
  /** Optional secondary line (city, dates, age groups). */
  subtitle?: string;
  /** Remote http(s) URL (PDF or image) or `bundled:<asset-key>`. */
  mapUrl: string;
  /** Optional related info page (volleyball.ca city page, etc.). */
  infoPageUrl?: string;
}

export interface TournamentYear {
  year: number;
  events: TournamentEvent[];
  venue?: string;
  venueMapUrl?: string;
  /** URL to the competition info page — applies to all events in this year */
  infoPageUrl?: string;
  /** Standalone maps surfaced alongside (but separate from) the AES
   *  events list. Tap → opens VenueMapScreen with the given URL. */
  extraVenueMaps?: ExtraVenueMap[];
}

export interface Tournament {
  id: string;
  name: string;
  shortName: string;
  /** Optional emoji or icon hint */
  icon: string;
  years: TournamentYear[];
}

export interface Country {
  id: string;
  name: string;
  flag: string;
  tournaments: Tournament[];
}

export const TOURNAMENT_REGISTRY: Country[] = [
  {
    id: 'canada',
    name: 'Canada',
    flag: '🇨🇦',
    tournaments: [
      {
        id: 'ontario-championships',
        name: 'Ontario Championships',
        shortName: 'OCs',
        icon: '🏐',
        years: [
          {
            year: 2026,
            venue: 'Enercare Centre, Toronto',
            infoPageUrl:
              'https://www.ontariovolleyball.org/ocs-venue',
            events: [
              {
                key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8xX19UTFNCX18xNVVHX18xN1VCX0df0',
                label: 'Event 1',
                subtitle: 'TLSB, 15UG, 17UB/G',
                dates: 'Apr 16 – 18',
                venue: 'Enercare Centre, Toronto',
                venueMapUrl:
                  'https://cdn1.sportngin.com/attachments/document/b853-3557065/2026_OC_s_Map_Enercare.png',
                infoPageUrl:
                  'https://www.ontariovolleyball.org/ocs-venue',
              },
              {
                key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8yX182djZHX19UTFNHX18xNVVCXw2',
                label: 'Event 2',
                subtitle: '6v6G, TLSG, 15UB',
                dates: 'Apr 19 – 21',
                venue: 'Enercare Centre, Toronto',
                venueMapUrl:
                  'https://cdn1.sportngin.com/attachments/document/b853-3557065/2026_OC_s_Map_Enercare.png',
                infoPageUrl:
                  'https://www.ontariovolleyball.org/ocs-venue',
              },
              {
                key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8zX182djZCX18xNlVfXzE4VV81',
                label: 'Event 3',
                subtitle: '6v6B, 16U, 18U',
                dates: 'Apr 23 – 25',
                venue: 'Enercare Centre, Toronto',
                venueMapUrl:
                  'https://cdn1.sportngin.com/attachments/document/b853-3557065/2026_OC_s_Map_Enercare.png',
                infoPageUrl:
                  'https://www.ontariovolleyball.org/ocs-venue',
              },
            ],
          },
        ],
      },
      {
        id: 'canadian-nationals',
        name: 'Canadian National Championships',
        shortName: 'Nationals',
        icon: '🏆',
        years: [
          {
            year: 2026,
            venue: 'Multiple Cities',
            infoPageUrl:
              'https://volleyball.ca/en/competitions/2026-youth-nationals',
            // All six 2026 Nationals AES events wired up. Calgary hosts
            // the BMO Centre flagship across 4 staged waves (the age
            // assignment per wave is published on the volleyball.ca
            // Calgary page); Mississauga, Edmonton, Moncton, and Ottawa
            // each host a single event. Maps live remote on
            // volleyball.ca so revisions land without an APK push.
            events: [
              {
                // 2026_Volleyball_Canada_Nationals___14UB___15UB
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNFVCX19fMTVVQg2',
                label: 'Mississauga — 14UB & 15UB',
                subtitle: '14U Boys, 15U Boys',
                dates: 'May 2026',
                venue: 'International Centre, Mississauga',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Mississauga-V3.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/mississauga-2026',
              },
              {
                // 2026_Volleyball_Canada_14U_Nationals_Edmonton
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX0VkbW9udG9u0',
                label: 'Edmonton — 14U',
                subtitle: '14U Nationals',
                dates: 'May 2026',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Edmonton-V3.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/edmonton-2026',
              },
              {
                // 2026_Volleyball_Canada_14U_Nationals_Moncton
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX01vbmN0b241',
                label: 'Moncton — 14U',
                subtitle: '14U Boys, 14U Girls',
                dates: 'May 2026',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Moncton-V3.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/moncton-2026',
              },
              {
                // 2026_Volleyball_Canada_14U_Nationals_Ottawa
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX090dGF3YQ2',
                label: 'Ottawa — 14U',
                subtitle: '14U Nationals (kickoff)',
                dates: 'May 2026',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Ottawa-3ftx4ft-REVISED.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/ottawa-2026',
              },
              // ── Calgary — BMO Centre flagship, 4 staged waves ──
              // Wave-to-age assignment confirmed from
              // volleyball.ca/.../calgary-2026:
              //   T1: 17U Girls
              //   T2: 17U Boys + 18U Girls + 18U Boys
              //   T3: 14U Boys + 15U Girls
              //   T4: 16U Boys + 16U Girls
              // On May 19 VC consolidated to a single "Tournament2-4" PDF,
              // and the legacy T1 PDF has been unreliable, so we point all
              // four registry entries at the same MAY19 map. If VC ships a
              // distinct T1 map again later, split it then.
              {
                // 2026_Volleyball_Canada_Nationals___17UG
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xN1VH0',
                label: 'Calgary — T1 (17UG)',
                subtitle: '17U Girls',
                dates: 'May 2026',
                venue: 'BMO Centre, Calgary',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4-MAY19-Checkin-Right.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/calgary-2026',
              },
              {
                // 2026_Volleyball_Canada_Nationals___17UB__18UG___18UB
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xN1VCX18xOFVHX19fMThVQg2',
                label: 'Calgary — T2 (17UB & 18U)',
                subtitle: '17U Boys, 18U Girls, 18U Boys',
                dates: 'May 2026',
                venue: 'BMO Centre, Calgary',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4-MAY19-Checkin-Right.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/calgary-2026',
              },
              {
                // 2026_Volleyball_Canada_Nationals___14UB___15UG
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNFVCX19fMTVVRw2',
                label: 'Calgary — T3 (14UB & 15UG)',
                subtitle: '14U Boys, 15U Girls',
                dates: 'May 2026',
                venue: 'BMO Centre, Calgary',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4-MAY19-Checkin-Right.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/calgary-2026',
              },
              {
                // 2026_Volleyball_Canada_Nationals___16UB___16UG
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNlVCX19fMTZVRw2',
                label: 'Calgary — T4 (16U)',
                subtitle: '16U Boys, 16U Girls',
                dates: 'May 2026',
                venue: 'BMO Centre, Calgary',
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4-MAY19-Checkin-Right.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/calgary-2026',
              },
            ],
          },
          {
            year: 2025,
            venue: 'Multiple Cities',
            events: [
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNVVHX19fMTdVQg2',
                label: 'Event 1',
                subtitle: '15U Girls, 17U Boys',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNlVHX19fMTdVRw2',
                label: 'Event 2',
                subtitle: '16U Girls, 17U Girls',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNlVCX18xOFVHX19fMThVQg2',
                label: 'Event 3',
                subtitle: '16U Boys, 18U Girls, 18U Boys',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNVVC0',
                label: 'Event 4',
                subtitle: '15U Boys',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX1dpbm5pcGVn0',
                label: '14U Nationals — Winnipeg',
                subtitle: '14U (Winnipeg)',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX0ZyZWRlcmljdG9u0',
                label: '14U Nationals — Fredericton',
                subtitle: '14U (Fredericton)',
                dates: 'May 2025',
              },
              {
                key: 'MjAyNV9Wb2xsZXliYWxsX0NhbmFkYV8xNFVfTmF0aW9uYWxzX090dGF3YQ2',
                label: '14U Nationals — Ottawa',
                subtitle: '14U (Ottawa)',
                dates: 'May 2025',
              },
            ],
          },
        ],
      },
      {
        id: 'new-year-classic',
        name: 'New Year Classic',
        shortName: 'NYC',
        icon: '🎆',
        years: [
          {
            year: 2026,
            venue: 'TBD',
            events: [
              {
                key: 'MjAyNl9PVkFfTmV3X1llYXJfc19PcGVu0',
                label: 'New Year Classic 2026',
                subtitle: 'OVA New Year Classic',
                dates: 'Jan 2026',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'usa',
    name: 'USA',
    flag: '🇺🇸',
    tournaments: [
      {
        id: 'usav-nationals',
        name: 'USAV Nationals',
        shortName: 'USAV',
        icon: '🏐',
        years: [
          {
            year: 2026,
            venue: 'TBD',
            events: [
              {
                key: '45433',
                label: 'Pre-Nationals Scrimmage',
                subtitle: 'USAV 2026',
                dates: '2026',
              },
            ],
          },
        ],
      },
    ],
  },
];

/** Helper: get available years for a tournament, sorted newest first */
export function getAvailableYears(tournament: Tournament): number[] {
  return tournament.years
    .map((y) => y.year)
    .sort((a, b) => b - a);
}

/** Helper: get a specific tournament year config */
export function getTournamentYear(
  tournament: Tournament,
  year: number
): TournamentYear | undefined {
  return tournament.years.find((y) => y.year === year);
}

/** Helper: find an event (with its surrounding year context) by AES event
 *  key, searching across the entire registry. Used by the menu navigation
 *  path where `selectedTournamentYear` is null — e.g. entering via MyTeams
 *  → TeamDashboard, which loads events directly without going through the
 *  TournamentSelect picker. Returning the year as well lets callers fall
 *  back to year-level `venueMapUrl` / `infoPageUrl` when the event itself
 *  doesn't carry one. */
export function findEventByKey(
  registry: Country[],
  eventKey: string
): { event: TournamentEvent; year: TournamentYear } | undefined {
  for (const country of registry) {
    for (const tournament of country.tournaments) {
      for (const year of tournament.years) {
        const event = year.events.find((e) => e.key === eventKey);
        if (event) return { event, year };
      }
    }
  }
  return undefined;
}
