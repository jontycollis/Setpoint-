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
            events: [
              // Only include events with confirmed AES keys.
              // Other city events (Calgary, Edmonton, Moncton, Ottawa) will
              // be populated automatically by the dynamic discovery system
              // once they appear on AES.
              {
                key: 'MjAyNl9Wb2xsZXliYWxsX0NhbmFkYV9OYXRpb25hbHNfX18xNFVCX19fMTVVQg2',
                label: 'Mississauga — 14UB & 15UB',
                subtitle: '14U Boys, 15U Boys',
                dates: 'May 2026',
                venue: 'International Centre, Mississauga',
                // V3 PDF on volleyball.ca — supersedes the bundled
                // PNG that shipped earlier. Remote URL means users
                // always see the latest revision without an APK push.
                venueMapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Mississauga-V3.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals/mississauga-2026',
              },
            ],
            // Standalone venue maps for cities whose AES events haven't
            // been indexed yet. Surfaced as cards below the events
            // list — same pinch-to-zoom flow, no AES key dependency.
            // When AES indexes these events, dynamic discovery will
            // add proper TournamentEvent entries and these standalone
            // cards can be replaced (or kept as a no-cost fallback).
            extraVenueMaps: [
              {
                label: 'Calgary — Tournament 1',
                subtitle: 'May 2026 · BMO Centre / Stampede Park',
                mapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament1.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals',
              },
              {
                label: 'Calgary — Tournaments 2–4',
                subtitle: 'May 2026 · BMO Centre / Stampede Park',
                mapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals',
              },
              {
                label: 'Moncton',
                subtitle: 'May 2026',
                mapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Moncton-V3.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals',
              },
              {
                label: 'Ottawa',
                subtitle: 'May 2026',
                mapUrl:
                  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Ottawa-3ftx4ft-REVISED.pdf',
                infoPageUrl:
                  'https://volleyball.ca/en/competitions/2026-youth-nationals',
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
