// ── In-app help content (single source of truth) ─────────────────────────
//
// Content shape is a typed block tree so the same module can drive:
//   • src/screens/HelpScreen.tsx — collapsible accordion in the app
//   • scripts/build-user-guide.ts — exports Markdown + HTML, which the
//     `pdf` skill renders to docs/USER_GUIDE.pdf
//
// No external markdown deps — keeps the help feature OTA-safe (pure JS,
// no native module changes).

export type HelpBlock =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'li'; text: string }
  | { type: 'tip'; text: string }
  | { type: 'note'; text: string };

export interface HelpSection {
  id: string;
  title: string;
  /** One-line teaser shown in the accordion header before tapping. */
  summary: string;
  blocks: HelpBlock[];
}

// Stable IDs are referenced by HelpButton consumers; never rename without
// updating every screen that targets them.
export const HELP_SECTION_IDS = {
  GETTING_STARTED: 'getting-started',
  MY_HOME: 'my-home',
  TEAM_DASHBOARD: 'team-dashboard',
  SCOREBOARD: 'scoreboard',
  SCORE_MATCH: 'score-match',
  ANALYTICS: 'analytics',
  SEASON_HISTORY: 'season-history',
  STANDINGS_BRACKETS: 'standings-brackets',
  ADD_TOURNAMENTS: 'add-tournaments',
  CONNECTION: 'connection',
  OVA_RANKINGS: 'ova-rankings',
  PRIVACY: 'privacy',
  FAQ: 'faq',
} as const;

export type HelpSectionId = (typeof HELP_SECTION_IDS)[keyof typeof HELP_SECTION_IDS];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: HELP_SECTION_IDS.GETTING_STARTED,
    title: 'Getting started',
    summary: 'Add your first team, pick a tournament, see your week.',
    blocks: [
      {
        type: 'p',
        text:
          'AES Score Tracker is a companion app for volleyball families and coaches. It pulls the schedules, standings, and brackets from AES and Timu, lets you score matches yourself, and rolls up everything you do into a single per-team Season History and analytics dashboard.',
      },
      { type: 'h3', text: 'First launch' },
      {
        type: 'li',
        text:
          'Tap “Add team” to set yourself up. Pick AES if your team plays AES-managed events; Timu if it plays Ontario tour stops. You can add both later — the app handles mixed seasons natively.',
      },
      {
        type: 'li',
        text:
          'You can also tap “Browse tournaments” first if you just want to look around without committing a team. Add a team later from the hamburger menu.',
      },
      { type: 'h3', text: 'Three things you should try in your first session' },
      {
        type: 'li',
        text:
          'Open My Home — your dashboard. Your tracked teams, next match, and the upcoming-tournaments list all live here.',
      },
      {
        type: 'li',
        text:
          'Open your Team Dashboard. It is the most-used screen in the app: live next-match countdown, recent results, division standings, pool play, and quick links into deeper views.',
      },
      {
        type: 'li',
        text:
          'Open the Scoreboard. Even if you don’t intend to score officially, the hold-up flipboard works as a referee’s scoreboard during a friendly or warm-up.',
      },
      {
        type: 'tip',
        text:
          'Every screen has a “?” button in the top-right that jumps to the relevant section of this help guide.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.MY_HOME,
    title: 'My Home',
    summary: 'Your dashboard: tracked teams, next match, upcoming events.',
    blocks: [
      {
        type: 'p',
        text:
          'My Home is the app’s landing pad. It’s organized around YOU — your tracked teams up top, the next match across all of them, and a roll-up of upcoming tournaments your teams are entered in or could enter.',
      },
      { type: 'h3', text: 'Tracked teams' },
      {
        type: 'li',
        text:
          'A coloured chip per team. Tap to open that team’s Dashboard. Long-press for actions — Manage roster, Remove, set as “Me” vs. “Watching”.',
      },
      {
        type: 'li',
        text:
          'The active team — the one whose pill is highlighted — drives the Team Analytics tile, the Quick Score tile, and the hamburger’s context.',
      },
      { type: 'h3', text: 'Next match card' },
      {
        type: 'li',
        text:
          'Shows the very next scheduled match across all your tracked teams, with a live countdown and court number. Tap it to open the scoreboard pre-wired for that match.',
      },
      {
        type: 'li',
        text:
          'Times are shown in the venue’s local time zone by default. The “Show in my time” toggle in the time-zone banner switches to your device time.',
      },
      { type: 'h3', text: 'Upcoming tournaments' },
      {
        type: 'li',
        text:
          'Cards roll up tournaments your teams are entered in, plus suggestions based on division + region. Tap a card to open the tournament; if your team is in it, you land directly on your team’s pool.',
      },
      {
        type: 'tip',
        text:
          'A magnifying-glass icon in the top-left of My Home opens Global Search — type any team name, club, athlete, or tournament to jump straight to it.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.TEAM_DASHBOARD,
    title: 'Team Dashboard',
    summary: 'Everything about one team: next match, standings, results.',
    blocks: [
      {
        type: 'p',
        text:
          'The Team Dashboard is the busiest screen in the app and the one most users open first thing in the morning. It is laid out top-to-bottom in order of urgency: live status, next match, current pool / standings, recent results, season-long stats.',
      },
      { type: 'h3', text: 'Live status banner' },
      {
        type: 'p',
        text:
          'If the team is currently playing — at the venue, between sets, on a court — the banner lights up with the live score and a tap-to-watch link to the live scoreboard.',
      },
      { type: 'h3', text: 'Next match card' },
      {
        type: 'li',
        text:
          'Countdown, court, opponent, set details. Tap to open the Scoreboard pre-wired for this match.',
      },
      {
        type: 'li',
        text:
          'Court number reads as “TBA” until the tournament posts a court assignment. The card refreshes automatically every minute.',
      },
      { type: 'h3', text: 'Pool / standings strip' },
      {
        type: 'li',
        text:
          'Shows the team’s current pool with W-L-set ratio and points. Tap any opponent row to open their Opponent Scout — recent results, roster, head-to-head if you have prior matches against them.',
      },
      { type: 'h3', text: 'Recent results' },
      {
        type: 'li',
        text:
          'The last 10 matches across all tournaments — both AES and Timu sources mixed. Each row taps through to the per-match boxscore.',
      },
      {
        type: 'tip',
        text:
          'Long-press the team pill in the top bar to switch active teams without closing the dashboard.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.SCOREBOARD,
    title: 'Scoreboard (hold-up flipboard)',
    summary: 'Quick-score a match on the bench. Works in landscape too.',
    blocks: [
      {
        type: 'p',
        text:
          'The Scoreboard is the hold-up flipboard you’d see on a referee’s stand. It is meant for casual / unofficial scoring — keeping track of a friendly, an exhibition, or just helping a player parent follow along. For full sanctioned scoresheets, use “Score a match” instead.',
      },
      { type: 'h3', text: 'Basic flow' },
      {
        type: 'li',
        text:
          'Pick your two teams (or open from a Team Dashboard / Next Match card to pre-fill). Tap either team’s number to bump their score.',
      },
      {
        type: 'li',
        text:
          'Tap and hold a number to subtract. Swipe down on the panel to start a new set.',
      },
      {
        type: 'li',
        text:
          'Rotate your phone to landscape — the scoreboard expands to a full-screen flipboard with the bottom tab bar hidden, perfect for propping the phone up courtside.',
      },
      { type: 'h3', text: 'Resume Match' },
      {
        type: 'p',
        text:
          'If you close the app or your phone locks while scoring, the live state is preserved for five minutes. Re-opening the app inside that window auto-resumes the match exactly where you left off — including current set, points, and serving team.',
      },
      {
        type: 'note',
        text:
          'After 5 minutes the resume prompt expires. Your set history is still saved if you’ve completed any sets.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.SCORE_MATCH,
    title: 'Score a match (full scoresheet)',
    summary: 'Sanctioned scoring with rotations, subs, timeouts, sanctions.',
    blocks: [
      {
        type: 'p',
        text:
          'Score a match is the full-fat scoring engine — rotations, libero tracking, substitutions, timeouts, sanctions, point-credit, and a proper boxscore at the end. Enable it via the hamburger → “Advanced Scoring” toggle. Off by default.',
      },
      { type: 'h3', text: 'Before the match' },
      {
        type: 'li',
        text:
          'Make sure both teams have a roster set up (Hamburger → Manage rosters). For opposing teams you can skim a minimal roster from the AES/Timu page.',
      },
      {
        type: 'li',
        text:
          'On the match setup screen, pick your starting lineup, libero(s), and captain. The court diagram previews positions 1–6.',
      },
      { type: 'h3', text: 'During the match' },
      {
        type: 'li',
        text:
          'Tap the court spot of the player who scored to credit them. The rotation walker advances automatically on a side-out.',
      },
      {
        type: 'li',
        text:
          'Substitutions: tap the bench player, then the on-court player to swap. The app enforces officer rules — a player can re-enter once per set into the same spot.',
      },
      {
        type: 'li',
        text:
          'Libero swap is automatic when a back-row player rotates in. You can override manually via the libero-on / libero-off buttons.',
      },
      { type: 'h3', text: 'After the match' },
      {
        type: 'li',
        text:
          'Boxscore page shows kills, errors, assists, digs, blocks, aces, plus serve-receive pass average. Tap any player row to drill into their per-set numbers.',
      },
      {
        type: 'tip',
        text:
          'Match data feeds the same Season History and Analytics screens as imported AES/Timu/Sideline HD matches — no separate place to look.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.ANALYTICS,
    title: 'Analytics & stats',
    summary: 'Per-player workbook, splits, lineups, sortable columns.',
    blocks: [
      {
        type: 'p',
        text:
          'Analytics aggregates every match your active team has played — AES, Timu, scored-in-app, and Sideline HD imports — into a single per-player dashboard. The layout mirrors the Excel workbook coaches were already using, just live and sortable.',
      },
      { type: 'h3', text: 'SPLIT chips' },
      {
        type: 'li',
        text:
          'A row of chips at the top filters which matches feed the numbers. Choose by Match kind (All / AES / Timu / Standalone), Match category (preseason / regular / playoff), Phase (group / playoff), or Source. Multiple splits compose.',
      },
      { type: 'h3', text: 'METRICS chips' },
      {
        type: 'li',
        text:
          'Below the splits — choose Basic (kills, blocks, aces, digs, errors), Advanced (on-court %, set win %, server splits), or Lineups (top scoring lineup combinations).',
      },
      { type: 'h3', text: 'Sortable columns' },
      {
        type: 'li',
        text:
          'Every column header in the per-player table is tappable. First tap sorts that column high → low; second tap flips low → high; tapping a different header resets to high → low. The active column is bold with a ▼ / ▲ chevron.',
      },
      { type: 'h3', text: 'Drill-in to a player' },
      {
        type: 'p',
        text:
          'Tap a player’s name to open their Player Detail screen: per-tournament breakdown, per-position splits, libero-call accuracy if applicable, and rotation-by-rotation server stats.',
      },
      { type: 'h3', text: 'What the columns mean' },
      {
        type: 'li',
        text:
          'M — matches the player was on court for. (Libero counts include any match where a libero marker, lineup, or court snapshot includes the player.)',
      },
      { type: 'li', text: 'Sets — same idea but at set granularity.' },
      {
        type: 'li',
        text:
          'OC % — on-court percentage. What share of rallies in the filtered matches the player was on court for.',
      },
      {
        type: 'li',
        text:
          'SW % — set-win percentage. Of the sets this player was on court for, the share that ended in a win.',
      },
      {
        type: 'li',
        text:
          'Pass avg — three-point passing average (3 = perfect, 0 = ace against). Sourced from Sideline HD imports or from in-app scoring.',
      },
      {
        type: 'tip',
        text:
          'Use the “?” chip next to any column header to see its full definition without leaving the screen.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.SEASON_HISTORY,
    title: 'Season History',
    summary: 'All your matches, both AES and Timu, in one timeline.',
    blocks: [
      {
        type: 'p',
        text:
          'Season History is the single cross-system view of every match your team has played this season. AES tournaments, Timu tournaments, standalone scoring, and Sideline HD imports are merged on date and rendered as a unified timeline.',
      },
      { type: 'h3', text: 'Tournament tiles' },
      {
        type: 'li',
        text:
          'Each tournament is a card with finish, set ratio, and a tappable list of matches. Tap a match to open its boxscore.',
      },
      { type: 'h3', text: 'Upcoming tournament cards' },
      {
        type: 'li',
        text:
          'Cards for tournaments that haven’t started yet appear at the top. Tap to open the tournament page — your team’s pool is highlighted in your division’s colour.',
      },
      { type: 'h3', text: 'Filtering' },
      {
        type: 'li',
        text:
          'Use the source chip (AES / Timu / All) to focus on one system if your season mixes both.',
      },
      {
        type: 'tip',
        text:
          'Pull-to-refresh re-fetches Timu and AES feeds and merges any newly-finalized matches.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.STANDINGS_BRACKETS,
    title: 'Standings & playoff brackets',
    summary: 'Pool play, division ranks, playoff seedings and brackets.',
    blocks: [
      {
        type: 'p',
        text:
          'Standings shows live pool play results — match record, set ratio, points, head-to-head tiebreakers — and updates as match results come in from AES.',
      },
      { type: 'h3', text: 'Standings' },
      {
        type: 'li',
        text:
          'Sortable by record, set ratio, or alphabetical. Tap any team row to open Opponent Scout for head-to-head context.',
      },
      { type: 'h3', text: 'Playoff brackets' },
      {
        type: 'li',
        text:
          'Renders the bracket tree once playoffs are seeded. Tap any match to drill into the boxscore. Win Probability Bar above the bracket projects your team’s path forward based on current standings.',
      },
      {
        type: 'note',
        text:
          'Both screens depend on AES publishing results in real time. If the bracket looks stale, pull-to-refresh.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.ADD_TOURNAMENTS,
    title: 'Find or add tournaments',
    summary: 'Browse AES + Timu by region. Add your team’s next event.',
    blocks: [
      {
        type: 'p',
        text:
          'The Find or add tournaments screen is how you bring new tournaments into your team’s season. Both AES and Timu can be browsed by date or region.',
      },
      { type: 'h3', text: 'Searching' },
      {
        type: 'li',
        text:
          'Type a tournament name, city, or club. Results are de-duplicated across AES and Timu — if a tournament is listed in both, you’ll see one card with both sources.',
      },
      { type: 'h3', text: 'Adding to your season' },
      {
        type: 'li',
        text:
          'Tap a tournament to preview, then “Track this tournament” to add it. The roll-up in My Home and Season History updates immediately.',
      },
      {
        type: 'tip',
        text:
          'For 2026 Nationals (Edmonton + city events), venue maps are bundled — open any 2026 Nationals tournament to see them.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.CONNECTION,
    title: 'OVA MRS & CAC Locker',
    summary: 'Optional logins for affiliations + NCCP cert checks.',
    blocks: [
      {
        type: 'p',
        text:
          'The Connection screens are entirely optional. They embed the OVA Member Registration System (MRS) and the Coaches Association of Canada (CAC) Locker so you can check your own affiliations, registrations, and certifications without leaving the app.',
      },
      { type: 'h3', text: 'What it does' },
      {
        type: 'li',
        text:
          'MRS — your OVA affiliation, club membership, registration status, insurance.',
      },
      {
        type: 'li',
        text:
          'CAC Locker — your NCCP coaching certifications and pathway.',
      },
      { type: 'h3', text: 'What it doesn’t do' },
      {
        type: 'li',
        text:
          'It doesn’t pull or store your credentials anywhere — the WebView simply hosts the official sites with the navigation chrome trimmed for a nicer mobile experience. Logins go directly to OVA / CAC servers.',
      },
      {
        type: 'note',
        text:
          'If you don’t coach or play officially, you can ignore both screens. They’re tucked into Connections & Settings in the hamburger.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.OVA_RANKINGS,
    title: 'OVA Rankings',
    summary: 'Live Girls + Boys rankings across every division.',
    blocks: [
      {
        type: 'p',
        text:
          'OVA Rankings mirrors the official Ontario Volleyball Association rankings — R1, R2, R3 — for every age category and division, Girls and Boys. Numbers update as the OVA publishes new rounds.',
      },
      {
        type: 'li',
        text:
          'Tap any team in the rankings list to open their team page — recent results, current tournament, and a one-tap “Add to My Teams” affordance.',
      },
      {
        type: 'tip',
        text:
          'Rankings is also the easiest way to discover a team if you don’t know which tournament they’re currently in.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.PRIVACY,
    title: 'Privacy & data',
    summary: 'What we store on your device, what we send, what we don’t.',
    blocks: [
      {
        type: 'p',
        text:
          'Short version: your data stays on your device. The app contacts AES, Timu, OVA, and CAC to fetch tournament + ranking data. It does not send your data anywhere except anonymized crash reports.',
      },
      { type: 'h3', text: 'On-device storage' },
      {
        type: 'li',
        text:
          'Your tracked teams, scored matches, roster, preferences, and a small storage snapshot (for the Restore-from-backup affordance) live in the app’s sandbox. They never leave your phone unless you explicitly share a screen.',
      },
      { type: 'h3', text: 'Crash reports' },
      {
        type: 'li',
        text:
          'If the app crashes, Sentry collects a stack trace and a redacted snapshot of the app state. IPs are dropped before the report leaves your phone.',
      },
      {
        type: 'p',
        text:
          'See Hamburger → About & privacy for the full privacy policy and links to the hosted version.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.FAQ,
    title: 'FAQ',
    summary: 'Common confusions and one-line answers.',
    blocks: [
      { type: 'h3', text: 'Why doesn’t my libero show match counts?' },
      {
        type: 'p',
        text:
          'Fixed in the May 2026 update. Sideline HD exports strip libero-on events; the app now infers libero participation from lineup snapshots, point credits, and substitution events.',
      },
      { type: 'h3', text: 'Why does the Scoreboard look cramped in landscape?' },
      {
        type: 'p',
        text:
          'It shouldn’t — the bottom tab bar is hidden in landscape and content padding clears the system nav buttons. If you see it covered, pull to portrait and back to refresh the layout, then update if a newer version is available.',
      },
      { type: 'h3', text: 'How do I share a screen / boxscore?' },
      {
        type: 'p',
        text:
          'Most analytics and match screens have a share button in the header. Tap it to export a snapshot card to Messages, Mail, or AirDrop.',
      },
      { type: 'h3', text: 'My next match is showing the wrong time zone.' },
      {
        type: 'p',
        text:
          'Times default to the venue’s local zone. Toggle “Show in my time” in the time-zone banner on My Home to switch to your device time.',
      },
      { type: 'h3', text: 'Where is my team’s data after I delete the app?' },
      {
        type: 'p',
        text:
          'Gone — everything is on-device. Use Hamburger → Restore from backup before deleting if you want a recovery point. There is no cloud backup.',
      },
      { type: 'h3', text: 'How do I report a bug or suggest a feature?' },
      {
        type: 'p',
        text:
          'Email jontycollis@gmail.com or use the contact link in About & privacy. Bug reports with a screenshot and the in-app version number (About → Version) are easiest to action.',
      },
    ],
  },
];
