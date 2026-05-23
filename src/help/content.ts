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
  HOME_LAUNCHER: 'home-launcher',
  MY_TEAMS_SECTION: 'my-teams-section',
  SINGLE_TEAM_SECTION: 'single-team-section',
  TOURNAMENTS_SECTION: 'tournaments-section',
  MY_HOME: 'my-home',
  TEAM_DASHBOARD: 'team-dashboard',
  SCOREBOARD: 'scoreboard',
  SCORE_MATCH: 'score-match',
  ANALYTICS: 'analytics',
  SEASON_HISTORY: 'season-history',
  SIDELINE_IMPORT: 'sideline-import',
  VENUE_MAP: 'venue-map',
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
          'Bior (BIR — Irish Gaelic for sharp point / spike) is a companion app for volleyball families and coaches. It pulls schedules, standings, and brackets from AES and Timu, lets you score matches yourself, and rolls everything up into a single per-team Season History and analytics dashboard.',
      },
      { type: 'h3', text: 'First launch' },
      {
        type: 'li',
        text:
          'You land on Home — a tile grid. Tap the My Team(s) tile and then "Add team" to set yourself up. Pick AES if your team plays AES-managed events; Timu if it plays Ontario tour stops. You can add both later — the app handles mixed seasons natively.',
      },
      {
        type: 'li',
        text:
          'You can also tap the Browse tile first if you just want to look around without committing a team. Add a team later from My Team(s) or the hamburger menu.',
      },
      { type: 'h3', text: 'Three things you should try in your first session' },
      {
        type: 'li',
        text:
          'Open My Team(s) → your team → Analytics. The per-player workbook is the most-loved screen for coaches and stat-watching parents.',
      },
      {
        type: 'li',
        text:
          'Open the Team Dashboard from My Team(s) → Tournaments. It is the most-used screen during a tournament weekend: live next-match countdown, recent results, division standings, pool play, and quick links into deeper views.',
      },
      {
        type: 'li',
        text:
          'Open the Scoreboard tile on Home. Even if you don’t intend to score officially, the hold-up flipboard works as a referee’s scoreboard during a friendly or warm-up.',
      },
      {
        type: 'tip',
        text:
          'Every screen has a "?" button in the top-right that jumps to the relevant section of this help guide.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.HOME_LAUNCHER,
    title: 'Home (tile launcher)',
    summary: 'The tile grid you land on every launch.',
    blocks: [
      {
        type: 'p',
        text:
          'Home is the app’s landing pad. It is a grid of tiles — one per major area of the app. Tap a tile to enter that section. Phones show two columns; tablets and landscape phones show three.',
      },
      { type: 'h3', text: 'The tiles' },
      {
        type: 'li',
        text:
          'Scoreboard — opens the hold-up flipboard and the rest of the in-app scoring tools.',
      },
      {
        type: 'li',
        text:
          'My Team(s) — your followed teams. Tap to drill into one team’s Analytics, Season History, Roster, and tournaments.',
      },
      {
        type: 'li',
        text:
          'Browse — search and discover tournaments and teams across AES and Timu without having to follow them first.',
      },
      {
        type: 'li',
        text:
          'Venue maps — jump straight to court / floor layouts. Bundled maps for 2026 Nationals are included; live tournaments link out to whichever PDF the host has published.',
      },
      {
        type: 'li',
        text:
          'MRS — the OVA Member Registration System, embedded as a WebView so you can check your affiliation, registration, and insurance without leaving the app.',
      },
      {
        type: 'li',
        text:
          'CAC Locker — the Coaches Association of Canada locker for your NCCP certifications, same embed pattern as MRS.',
      },
      {
        type: 'li',
        text:
          'OVA Rankings — live Girls and Boys rankings across every age and division.',
      },
      {
        type: 'li',
        text:
          'Help — this guide. You can also reach it from the "?" button on any screen.',
      },
      {
        type: 'tip',
        text:
          'The top bar stays put across every tile: search and active-team pill on the left, hamburger on the right. So you never lose your way back.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.MY_TEAMS_SECTION,
    title: 'My Team(s) section',
    summary: 'One tile per team you follow. Tap to drill in.',
    blocks: [
      {
        type: 'p',
        text:
          'My Team(s) is the home of every team you follow. Each team gets its own tile, sorted by kind — teams you’re on ("me") first, then teams you’re watching, newest first within each bucket. Tap a tile to enter that team’s section. A trailing "+ Add team" tile is always at the end.',
      },
      { type: 'h3', text: 'Team tiles' },
      {
        type: 'li',
        text:
          'Each tile shows a glyph (🏐 for teams you’re on, 👀 for teams you’re watching), the team label, and a one-line subtitle with age group · club · season when available.',
      },
      {
        type: 'li',
        text:
          'Tap the tile to drill into that team’s section — Analytics, Season History, Tournaments, Roster, Sideline HD import, and Add AES / Add Timu event.',
      },
      { type: 'h3', text: 'Below the tiles' },
      {
        type: 'p',
        text:
          'Underneath the tile grid you’ll find the legacy My Home content: Live Now (any of your teams currently playing), recently-viewed teams, a watching list, and your career card. So you can still see "what’s live across all my teams" without having to pick one first.',
      },
      {
        type: 'tip',
        text:
          'Add team also lives in the hamburger menu under MY TEAMS, alongside Manage rosters.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.SINGLE_TEAM_SECTION,
    title: 'One team’s section',
    summary: 'Per-team feature tiles: Analytics, History, Roster, etc.',
    blocks: [
      {
        type: 'p',
        text:
          'After tapping a team in My Team(s), you land on that team’s section. A header at the top names the team and shows the same age · club · season subtitle from the tile. Below sits a tile grid scoped to that one team.',
      },
      { type: 'h3', text: 'The tiles' },
      {
        type: 'li',
        text:
          'Analytics — per-player workbook with split + metric chips and sortable columns. Pulls from AES, Timu, in-app scoring, and Sideline HD imports.',
      },
      {
        type: 'li',
        text:
          'Season History — the team’s full timeline of tournaments across both AES and Timu, plus standalone scored matches and Sideline HD imports.',
      },
      {
        type: 'li',
        text:
          'Tournaments — a list of upcoming events the team is in or could enter. Tap an event to drop straight onto the team’s pool in that event.',
      },
      {
        type: 'li',
        text:
          'Roster — manage players, jersey numbers, and libero designation. Only enabled for teams you’re on; watching-team tiles dim this one out.',
      },
      {
        type: 'li',
        text:
          'Import Sideline HD — pull in historical match data the team logged in Sideline HD. See the Sideline HD import help section for what’s available today.',
      },
      {
        type: 'li',
        text:
          'Add AES event / Add Timu event — paste a tournament URL or pick from the AES/Timu directories to add an event the auto-discover missed.',
      },
      {
        type: 'tip',
        text:
          'The active-team pill in the top bar updates the moment you enter a team’s section, so the rest of the app (Quick Score, hamburger Dashboard fast-path) follows the team you just opened.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.TOURNAMENTS_SECTION,
    title: 'Tournaments (per team)',
    summary: 'Current Tournament + Add Tournaments — fast access to today.',
    blocks: [
      {
        type: 'p',
        text:
          'The Tournaments section sits inside one team’s page and has two tiles: Current Tournament and Add Tournaments. It replaces the older split where the Tournaments tile dropped you straight into the AES/Timu chooser.',
      },
      {
        type: 'li',
        text:
          'Current Tournament — points at whichever tournament is in progress now or starting within the next 7 days. Tap to open that tournament’s dashboard (AES or Timu).',
      },
      {
        type: 'li',
        text:
          'Add Tournaments — opens the AES + Timu chooser so you can paste a URL or pick a tournament that auto-discovery missed.',
      },
      {
        type: 'tip',
        text:
          'When no tournament is active, tapping Current Tournament falls through to Add Tournaments — same destination, single forward path.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.MY_HOME,
    title: 'My Home (legacy dashboard)',
    summary: 'Live Now, recents, watching list, career card.',
    blocks: [
      {
        type: 'p',
        text:
          'My Home is the legacy dashboard that used to be the app’s landing pad. It still exists — embedded inside My Team(s) and reachable from the hamburger’s MY TEAMS section — but Home (the tile launcher) is where you start now.',
      },
      { type: 'h3', text: 'Live Now' },
      {
        type: 'li',
        text:
          'Surfaces any of your tracked teams that are currently playing, with the live score and a tap-to-watch link to the scoreboard.',
      },
      { type: 'h3', text: 'Recently viewed' },
      {
        type: 'li',
        text:
          'The last few teams, tournaments, or players you opened, in reverse-chronological order. Tap to jump back.',
      },
      { type: 'h3', text: 'Watching list & career card' },
      {
        type: 'li',
        text:
          'Teams you marked as "watching" sit in a horizontal strip. The career card on the bottom rolls up your "me" teams’ career totals (matches, wins, set ratio).',
      },
      {
        type: 'tip',
        text:
          'A magnifying-glass icon in the top-left opens Global Search — type any team, club, athlete, or tournament name to jump straight to it. The search icon is available from every screen, including Home.',
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
          'The Team Dashboard is the busiest screen in the app and the one most users open first thing in the morning during a tournament. It is laid out top-to-bottom in order of urgency: live status, next match, current pool / standings, recent results, season-long stats.',
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
          'Court number reads as "TBA" until the tournament posts a court assignment. The card refreshes automatically every minute.',
      },
      { type: 'h3', text: 'Day filter chips' },
      {
        type: 'p',
        text:
          'A row of day chips (Today / Tomorrow / Fri / Sat / …) sits above the match list, letting you focus on one day of the tournament. The chips are now data-driven from the actual schedule, so future-only views never show a stale "Yesterday" chip the way an earlier build did. If there’s a Tomorrow match it shows up as "Tomorrow"; if not, the chip is omitted entirely.',
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
      { type: 'h3', text: 'Action buttons' },
      {
        type: 'li',
        text:
          'A row of buttons drops you straight into deeper tournament views: Standings, Playoff Brackets, and 🗺 Venue Map. Venue Map opens the bundled court / venue layout for the current tournament when one is available (e.g. 2026 Nationals).',
      },
      { type: 'h3', text: 'Upcoming tournaments' },
      {
        type: 'li',
        text:
          'Cards for the team’s next tournaments sit below recent results. Tap any card to drill straight into that tournament — your pool is highlighted in your division’s colour. The cards are tappable here, on Timu Team Dashboard, and on Season History.',
      },
      { type: 'h3', text: 'Times and time zones' },
      {
        type: 'p',
        text:
          'Tournament times default to the venue’s local time. When your device is in a different time zone, the next-match card and the schedule show both — venue time first, your local time in parentheses (e.g. "3:00 PM EDT (12:00 PM PDT)"). When the two zones match, you just see one time.',
      },
      {
        type: 'li',
        text:
          'A small toggle under the next-match block cycles through three modes: dual (both times) → venue-only → your-time-only → back to dual. Tap to switch. The choice is remembered across launches.',
      },
      {
        type: 'li',
        text:
          'Notifications fire at the correct real-world moment regardless of your device time zone — a 9:00 AM PDT match notifies at 9:00 AM PDT even if your phone is set to Eastern.',
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
          'The Scoreboard is the hold-up flipboard you’d see on a referee’s stand. It is meant for casual / unofficial scoring — keeping track of a friendly, an exhibition, or just helping a player parent follow along. For full sanctioned scoresheets, use "Score a match" instead.',
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
          'Score a match is the full-fat scoring engine — rotations, libero tracking, substitutions, timeouts, sanctions, point-credit, and a proper boxscore at the end. Enable it via the hamburger → "Advanced Scoring" toggle. Off by default.',
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
      { type: 'h3', text: 'Export an OVA-format scoresheet PDF' },
      {
        type: 'p',
        text:
          'When a match is complete, you can export a printable OVA-format scoresheet as PDF. The button (🖨 Export OVA scoresheet PDF) appears in three places: on the match-end banner inside the scoring screen, on the post-match save sheet, and as a "🖨 PDF" chip on each completed match in the Match List.',
      },
      {
        type: 'li',
        text:
          'The PDF includes: header (tournament / division / court / date), team cards with coaches, captains, libero(s) and full roster, officials block, per-set lineup grid with point progression, sub log, libero replacements, timeouts and sanctions, match summary, and signature lines for captains / coaches / referees / scorer.',
      },
      {
        type: 'li',
        text:
          'Generation uses the system print dialog and then hands off to your phone’s share sheet — email it to your coach, save to Files, or send straight to a printer.',
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
          'Use the "?" chip next to any column header to see its full definition without leaving the screen.',
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
          'Cards for tournaments that haven’t started yet appear at the top. They are tappable — open the AES or Timu tournament directly, with your team’s pool highlighted in your division’s colour.',
      },
      { type: 'h3', text: 'Finding more tournaments' },
      {
        type: 'li',
        text:
          'Two buttons sit alongside the upcoming-tournaments list. "Scan for Tournaments" re-runs the auto-search across AES and Timu for events your team could be in. "Manually Add a Tournament" lets you paste a URL for a tournament that auto-search didn’t catch.',
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
    id: HELP_SECTION_IDS.SIDELINE_IMPORT,
    title: 'Import from Sideline HD',
    summary: 'Pull in historical match data the team logged in Sideline HD.',
    blocks: [
      {
        type: 'p',
        text:
          'If your team has been logging matches in Sideline HD, you can import that history into Bior and have it merged with your AES / Timu schedule on the same Analytics and Season History screens. The importer lives at My Team(s) → your team → Import Sideline HD.',
      },
      { type: 'h3', text: 'What works today' },
      {
        type: 'li',
        text:
          'Login. Tap the tile and the in-app Sideline HD login WebView opens. Sign in with your Sideline HD credentials. We never see your password — the WebView talks directly to sidelinehd.com, the same way Safari would.',
      },
      {
        type: 'li',
        text:
          'Session storage. After you log in, the importer captures the session cookies and remembers them, so you don’t have to log in again every visit. A "Sign out" affordance is available if you want to clear them.',
      },
      { type: 'h3', text: 'What’s rolling out next' },
      {
        type: 'li',
        text:
          'Team picker — once you’re signed in, Bior will show the list of teams your Sideline HD account has access to, so you can pick which one to pull from. (Shipping in a follow-up session.)',
      },
      {
        type: 'li',
        text:
          'Scrape + import — walk the selected team’s matches, parse rally data into the same Match shape the rest of the app uses, and confirm + dedupe before saving. (Same follow-up.)',
      },
      {
        type: 'note',
        text:
          'The importer requires native cookie support that ships in the APK / IPA build, not OTA. If you see "Available in next app version" instead of the login WebView, update the app from the store and try again.',
      },
    ],
  },
  {
    id: HELP_SECTION_IDS.VENUE_MAP,
    title: 'Venue map',
    summary: 'Find your court at the venue.',
    blocks: [
      {
        type: 'p',
        text:
          'Venue Map shows the floor plan for the tournament you’re at. For bundled events (2026 Nationals: Edmonton + city events) the map ships inside the app and opens instantly. For other tournaments, Bior fetches whatever map the host has published — usually a PDF on volleyball.ca — and renders it in-app.',
      },
      { type: 'h3', text: 'Pinch to zoom' },
      {
        type: 'li',
        text:
          'Pinch and pan to zoom into your court. The viewer keeps the page sharp at high zoom levels so court numbers stay legible. Double-tap to snap back to the full page.',
      },
      {
        type: 'li',
        text:
          'When the dashboard opens the map for a specific match, the court number you’re looking for is shown on a small "Find: Court N" banner above the map so you don’t have to memorise it while pinching around.',
      },
      { type: 'h3', text: 'If the map won’t load' },
      {
        type: 'p',
        text:
          'Some venues publish PDFs that don’t render cleanly inside the in-app viewer (older PDF versions, oversize files, hosting-side blocks). When that happens, an "Open PDF in browser" link is always available — both as the primary action on the error screen and as a small footer link under the viewer. The browser handoff opens the same PDF directly, where your phone’s built-in viewer can take over.',
      },
      {
        type: 'tip',
        text:
          'No map published yet? You’ll see a "No Venue Map Available" placeholder with a link to the host’s competition page — most tournaments post a venue map about a week before play starts.',
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
        type: 'p',
        text:
          'Bracket match cards now show the court and scheduled time when AES has them. Open rounds (e.g. championship match TBD) hide the strip when the data isn’t available, so the bracket stays clean.',
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
          'The Find or add tournaments screen is how you bring new tournaments into your team’s season. Both AES and Timu can be browsed by date or region. You can also reach it from My Team(s) → your team → Tournaments.',
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
          'Tap a tournament to preview, then "Track this tournament" to add it. The roll-up in My Team(s) and Season History updates immediately.',
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
          'MRS and CAC Locker are entirely optional. They embed the OVA Member Registration System and the Coaches Association of Canada Locker so you can check your own affiliations, registrations, and certifications without leaving the app. Both have their own tile on Home.',
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
          'If you don’t coach or play officially, you can ignore both tiles.',
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
          'Tap any team in the rankings list to open their team page — recent results, current tournament, and a one-tap "Add to My Teams" affordance.',
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
          'Short version: your data stays on your device. The app contacts AES, Timu, OVA, CAC, and (if you sign in) Sideline HD to fetch tournament + ranking + match data. It does not send your data anywhere except anonymized crash reports.',
      },
      { type: 'h3', text: 'On-device storage' },
      {
        type: 'li',
        text:
          'Your tracked teams, scored matches, rosters, preferences, Sideline HD session cookies, and a small storage snapshot (for the Restore-from-backup affordance) live in the app’s sandbox. They never leave your phone unless you explicitly share a screen.',
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
      { type: 'h3', text: 'Wait, wasn’t this app called Setpoint?' },
      {
        type: 'p',
        text:
          'Yes — it was renamed to Bior (BIR — Irish Gaelic for "sharp point" / "spike") in early 2026. Same app, new name and icon. All your data carries over without you having to do anything.',
      },
      { type: 'h3', text: 'Where did the old My Home screen go?' },
      {
        type: 'p',
        text:
          'It still exists. Home is now a tile launcher; the old My Home (Live Now, recents, watching list, career card) is embedded inside the My Team(s) section, below the per-team tile grid. You can also jump straight to it from the hamburger’s MY TEAMS section.',
      },
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
          'Times default to the venue’s local zone. When your device is in a different zone, you should see both — venue time first, your local time in parentheses. The dual / venue-only / your-time toggle lives on Team Dashboard, just under the next-match block. Notifications fire at the correct real-world moment regardless of which mode you pick.',
      },
      { type: 'h3', text: 'The venue map won’t open / shows blank.' },
      {
        type: 'p',
        text:
          'Tap "Open PDF in browser" — it’s the primary action on the error screen and the small footer link under the viewer. That hands the same PDF off to your phone’s built-in viewer, which handles edge-case PDFs (older versions, big files) the in-app viewer can’t.',
      },
      { type: 'h3', text: 'How do I get help on a specific screen?' },
      {
        type: 'p',
        text:
          'Every screen has a "?" button in the top-right that opens this help guide deep-linked to the relevant section. Inside the help screen there is also a search bar at the top — type a keyword ("libero", "PDF", "time zone") and the matching sections expand inline.',
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
