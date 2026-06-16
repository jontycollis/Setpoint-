# Setpoint — UX Audit & Redesign Proposal

User's complaint, verbatim:

> i am not sure the entry in to the app is all that intuitive, i think we have some great features but we need to work on the look and feel, lets clean it up
>
> it isnt clear whwre to go in the app, what the features are yhe interactions arent intuitive

> the home shouldnt be a coches screen it should be for any user

This document is an audit of the shipped IA against those complaints, then a tight set of high-leverage proposals to fix wayfinding for **any** user — athletes, parents, coaches, scorekeepers, club staff, casual spectators.

---

## Phase 1 — Audit

### What's actually shipped (IA in one paragraph)

Three bottom tabs: **Home** (MyHome), **Browse** (TournamentSelect), **Tools**. A persistent hamburger sits top-right; a floating top-bar shows the active-team pill (only on team-context screens) and a magnifying-glass search icon (only on MyHome). Boot lands on MyHome regardless of whether the user has teams. MyHome stacks: tall blue hero with display name + role kicker → sync row or discovery banner → recently-viewed strip (when populated) → MY TEAMS cards with "+ Add team" → WATCHING (when populated) → CONNECTIONS (OVA MRS + CAC Locker) → CAREER TOTALS card. The hamburger duplicates much of this and adds tournament-context entries when inside an event. Tools tab, by default, contains only the same Connections section that's already on Home — a near-empty third tab for any user who hasn't enabled the hidden Advanced Scoring toggle.

### Scenario walkthroughs

**Athlete (U17 girl), first launch.** Sees a blue hero saying "My home" with no role kicker, an empty-state card explaining "No teams yet — find a tournament you're playing in", and a `+ Add team` button. No idea what AES vs Timu means. Taps `+ Add team` → AddTeamChooser asks her to pick AES or Timu. Even with the helpful copy ("Not sure which? AES is at advancedeventsystems.com…"), she likely doesn't know which one her tournament uses. If she picks AES she gets a country picker; if she picks Timu she gets a screen asking her to paste a URL. Neither matches her mental model of "find my team." There is no search. The magnifying-glass icon on the top bar would let her search globally, but it only appears once she's on MyHome with content, and the corpus is empty until she's added something. Dead-end loop.

**Parent following one or two kids.** Same opening as the athlete. After successfully adding a team, MyHome shows their team card with a "next tournament" line. To follow a second kid's team she taps `+ Add team` again. After two kids she has two cards on Home — but no concept of "today's matches across both kids" anywhere. The hamburger's MY TEAMS section gives a one-tap switcher and a "+ Add team" CTA — duplicating MyHome. She'd probably never see the Cross-Tournament History feature, the Live Scoreboard, or OVA Rankings without random hamburger exploration.

**Coach.** Lands on the same generic Home. There is no dedicated "manage roster" or "score a match" entry visible. Roster editing is reachable only by **long-pressing a team card** and choosing "Manage roster" from an action sheet — completely undiscoverable. Tier 1 Simple Scoreboard lives in the hamburger's TOOLS section. Tier 2 Advanced Scoring is hidden behind a toggle in hamburger Settings. Cross-Tournament History only appears in the hamburger when in an event context. Most coaches will not find their main tools without a guide.

**Scorekeeper / official, first launch.** Wants the Tier 2 scoring console. Default state: Advanced Scoring is OFF. To find it: open hamburger → scroll to Settings → toggle Advanced Scoring → close and reopen the menu → tap Advanced Scoring under TOOLS. Five steps and a hidden toggle. Tier 1 hold-up scoreboard is one-tap from the hamburger TOOLS section but invisible from any of the three tabs by default.

**Returning user with three teams and a tournament weekend ahead.** Opens app → MyHome shows hero, sync row, recents strip, three team cards each with a "next tournament" line, watching list, Connections, career totals. Nowhere does it say: "Provincials starts Saturday — here's the bracket / venue map / your team's pool / your first match." She has to tap a team → land on Season History (because `onOpenTeam` routes to SeasonHistory, not the dashboard) → tap a tournament → land on the dashboard → scroll past three header rows of buttons to find the Next Match card. Five+ taps on a tournament weekend.

### Discoverability rating

| Where to find it | Items |
|---|---|
| **Surfaced** (visible without opening any menu) | MY TEAMS list & "+ Add team", recently-viewed strip, Career totals, Browse tab, Active-team pill (team-context only), MyHome connections cards |
| **Buried** (hamburger or one-deep modal) | Tier 1 Simple Scoreboard, OVA Rankings, Cross-Tournament History, Standings/Brackets/Court Schedule/Live Scoreboard/ClubView/Venue Map/Team Notes, Season History, global search (off MyHome), AddTournaments |
| **Hidden** (no on-screen affordance signals it) | Long-press to manage roster / remove team, Tier 2 Advanced Scoring (Settings-toggle-gated), Auto-discovery flow, Court video streams inside team dashboard, Indoor/Beach sport mode toggle on Tier 1 scoreboard, "Find more tournaments" force-rerun on Season History, win-probability bar / rotation strip / per-set timeline inside Tier 2 |

### Interaction inconsistencies

The AES TeamDashboard header cluster is the worst single offender: three near-identical action pills (`★ Favorite`, `+ Season`, `🏐 My Team`) all touch the same domain (follow this team) with subtle differences only experienced users understand. They also overlap silently — `+ Season` auto-toggles favorite, `Set My Team` upserts a TeamProfile, and the star adds a watching profile. New users will tap one, see something happen they don't understand, and avoid the cluster afterwards.

There are **two parallel team switchers**: the centred top-bar pill that opens a modal, and the hamburger MY TEAMS section that does the same thing. Both are reasonable in isolation; together they suggest the app is making the same decision twice.

There are **three different paths to "Browse tournaments"**: the Browse bottom tab, the hamburger's TOOLS → "Browse tournaments" entry, and the AddTeamChooser → "AES tournament" choice. The hamburger's row is internally labelled `Home` (a legacy name) while a sibling row called `My Home` routes to MyHome — the menu has two "Home" entries pointing at different screens.

The **Tools tab is effectively empty** for any user who hasn't enabled the hidden Advanced Scoring toggle. It contains only Connections, which already appear on MyHome.

The **CONNECTIONS section appears on both MyHome and Tools** (literal duplication). The relevant audience — Ontario users with OVA accounts, Canadian coaches with NCCP transcripts — is a small slice of any plausible user base. Promoting it as the third large section on a generic Home is wrong for athletes, parents, US users, and anyone outside Canada.

**`onOpenTeam` from MyHome routes to SeasonHistory, not the team dashboard**, even though a user tapping their team card on Home is most likely asking "what's next for this team?" — i.e. the dashboard. The current routing is technically defensible (history is the cross-tournament view) but it's the wrong default.

**Global search is reachable only from MyHome.** The corpus includes both AES and Timu indices and is genuinely good — but a user who's on a team dashboard or inside a tournament view has to navigate back to Home first.

**Hidden long-press on team cards** for "Manage roster / Remove team" — no chevron, no "..." button, no visual hint. The action sheet is well-built; the affordance is invisible.

### Honest take

The architecture is much better than the user feedback implies. The data model — TeamProfile, AES + Timu unified history, auto-discovery, recently-viewed across kinds, the season index — is impressively coherent. What's hurting the app is a layer of UI plumbing that grew organically as features were added: the bottom tabs and hamburger and top bar each accreted entries until none of them are clearly responsible for anything. The fix is mostly about **deciding what each surface is for, removing duplicates, and surfacing one or two things really well** — not about adding more.

The single thing the Home is missing that it most needs is an answer to "what should I look at right now?" — not a list of teams, not a list of features, just one thing leading. That's the role-agnostic reframing the user asked for.

---

## Phase 2 — Redesign Proposal (5 changes)

Each is scoped to fix wayfinding for **any** user. None redesign a feature screen — they redesign the surfaces a user touches when they don't yet know where to go.

### 1. Add a "Right Now" lead card to Home

**One-line summary:** Replace the static stack of Home sections with a single primary card at the top that infers the user's current focus from data, plus a quieter teams list below.

**Why it solves the complaint, across roles:** Every role's first question is the same — "what should I look at right now?" The current Home answers "here are some sections you might want." A "Right Now" card answers the question directly: live match underway → "Court 5 · Set 2 · 18-15"; today during a tournament → "Next match in 47 min · Court 3 · vs Defensa Rob"; tournament weekend ahead → "Provincials starts Saturday · Tap to see your pool"; nothing scheduled → "Welcome — add a team or browse tournaments." Same logic, different content, every role gets oriented in one glance. The team list, recently-viewed, watching, and connections all stay accessible but as supporting cast.

**Implementation cost:** Medium. The data is already computable: `getNextUpcomingTournament` exists, the season indices already drive the per-team upcoming line, `LiveMatchTracker` already exists for the live state. The card is an opinionated prioritisation layer over data the app already has.

**Visual layout description:** Top of MyHome below a slim status bar (no tall blue hero — the hero's job is done by the lead card). One full-width card, ~160 pt tall, with a kicker label that names the state ("LIVE NOW" / "TODAY" / "THIS WEEKEND" / "GET STARTED"), a single-line headline, a one-line supporting fact (court, time, opponent, tournament name, days-until), and exactly one primary CTA in the bottom-right ("Open scoreboard" / "View pool" / "Browse tournaments"). Below it: a horizontal Recently-viewed strip (only when populated) and the existing MY TEAMS list, slightly smaller and quieter than today. Watching, Connections, and Career totals continue to exist but move below the fold; Connections especially can drop off MyHome entirely (see #4).

### 2. Persistent global search in the top bar

**One-line summary:** Move the magnifying-glass icon from "MyHome only" to a permanent slot in the top bar across every screen.

**Why it solves the complaint, across roles:** Search is the single most universal escape hatch — every role uses it differently (athlete: my team; parent: cousin's team; coach: opponent scout; scorekeeper: the team they're scoring; spectator: anyone playing today). Right now you have to be on MyHome to use it. Making it persistent costs almost nothing and immediately answers "where do I go to find X" for every role on every screen.

**Implementation cost:** Small. The top-bar component already has a left search slot; the conditional `showSearch` logic just changes from "MyHome only" to "always when a user has any indexed data." The corpus and routing already exist.

**Visual layout description:** Magnifying-glass icon in the existing left slot of TopBar, persistent across MyHome, Browse, Tools, TeamDashboard, TimuTeamDashboard, SeasonHistory, OvaRankings — every non-modal screen. Hide on full-screen flows (scoring screens, the connection web views).

### 3. Replace Browse tab's country/tournament/year tree with search-first

**One-line summary:** When a user taps Browse, the first thing they see is a search field for "find a tournament or team," with the country tree as a "Browse all" affordance below.

**Why it solves the complaint, across roles:** The current Browse flow assumes users know exactly which tournament hierarchy their event lives under. Most don't — they know a name ("Provincials," "Nationals," "Hilltoppers"), or a team name. Search-first means a parent can type "hilltoppers" and find every tournament that team has appeared in across both AES and Timu, without picking Canada → Provincials → 2025. Power users who do know the hierarchy still have it one tap below.

**Implementation cost:** Small. The search corpus from GlobalSearchScreen already covers this. The country tree is the existing TournamentSelectScreen rendered below a search box.

**Visual layout description:** Browse screen top-third is a single full-width text input ("Search tournaments and teams") that filters live and routes through the existing `handleGlobalSearchSelect`. Below it, a small "BROWSE BY COUNTRY" label and the existing three-step tree, collapsed visually so search is clearly primary.

### 4. Remove the Tools tab; move its 1-2 entries elsewhere

**One-line summary:** The Tools tab is empty for default users and dupes Connections. Drop it; move "Score a Match" to a contextual primary action and Connections to a "Settings & connections" entry in the hamburger.

**Why it solves the complaint, across roles:** A bottom tab promises something useful. The current Tools tab promises Connections (already on Home) and a hidden scorer console. Killing it and going to two tabs (Home, Browse) makes the tab bar honest. For users who do score matches, "Score a Match" surfaces as a Right Now card CTA when they're at a tournament with their team, and as a top-of-hamburger entry — both more discoverable than a tab they'd never tap.

**Implementation cost:** Small. Delete the tab; reroute the two existing rows. The bottom tab bar already supports two tabs cleanly. The hamburger already has a TOOLS section that can host the orphans.

**Visual layout description:** Bottom tab bar shrinks from three icons (Home / Browse / Tools) to two (Home / Browse), each filling half the bar with bigger hit-targets. Hamburger gains a top-level "Score a match" entry (Tier 1 + Tier 2) and a "Connections & settings" group near the bottom.

### 5. Collapse the AES TeamDashboard header's three pills into one "Follow" button

**One-line summary:** Replace `★ Favorite` + `+ Season` + `🏐 My Team` with a single `Follow` / `Following` toggle that does the right thing, and surface "Set as primary team" + "Remove" inside an overflow menu only when the user has multiple followed teams.

**Why it solves the complaint, across roles:** This is the highest-friction trust moment in the app. Three buttons that look the same and do almost-the-same thing makes users defensive. One button that says "Follow" and means "track this team across my Home, my season history, the indexer, and the auto-discovery scan" is what every role wants the first time. Power users who want to mark a team as their primary still have an overflow option, but the default action is one tap.

**Implementation cost:** Small. The three actions already exist as separate handlers (`onToggleFavorite`, `handleAddToSeasonHistory`, `onSetAsMyTeam`); a wrapping `handleFollow` that calls them in sequence is a few lines. The visual change replaces three pills with one button + a "..." overflow when the user has >1 followed team.

**Visual layout description:** AES and Timu team headers each show one pill on the right: "Follow" (filled primary) → "Following ✓" (outlined). Tap the chevron next to "Following ✓" → action sheet with "Set as primary team" / "Manage roster" / "Stop following." First-time follow also auto-sets the team as primary if none exists yet. The cost of this consolidation is that experienced users lose one-tap access to "make this my primary without changing follow state," but that's a vanishingly rare operation.

### (Bench: 6. First-launch onboarding tour)

A 4-step coachmark overlay on first launch — "this is your home; tap here to find your team; this is the tournament browser; this is the menu" — would meaningfully help every first-time user. It's not in the top 5 because the first 5 changes alone make the app self-explanatory enough that an onboarding tour becomes a polish item rather than a necessity. Worth doing in v2 if support requests on "where do I go" persist after the v1 ships.

### (Bench: 7. "What's here" feature index in the hamburger)

A one-tap entry at the top of the hamburger labelled "What can Setpoint do?" listing every feature with a one-line description (Tier 1 hold-up scoreboard, Tier 2 advanced scoring, OVA Rankings, Venue Map, Cross-Tournament History, Bracket predictions, Court video streams, Roster manager, NCCP locker, etc.). Discovery-by-browsing for users who don't yet know what's possible. Cheap to build, modest impact compared to the structural changes above — bench unless feature awareness becomes the dominant complaint after v1.

---

## Phase 3 — Phasing (Polish v1)

Ranked by impact ÷ cost:

| # | Change | Impact (1-10) | Cost | Ratio |
|---|---|---|---|---|
| 2 | Persistent global search in top bar | 9 | small | ~9 |
| 4 | Remove Tools tab | 7 | small | ~7 |
| 3 | Browse tab: search-first | 8 | small | ~6 |
| 5 | Single Follow button on team headers | 7 | small | ~6 |
| 1 | "Right Now" lead card on Home | 9 | medium | ~3 |

**Recommended Polish v1 — ship together:**

1. **Persistent global search.** Tiny diff, immediate "I can find anything from anywhere" win for every role.
2. **Drop the Tools tab.** Tab-bar honesty; immediate signal that the IA was thought-through. Move the two orphans to the hamburger / Right Now CTAs.
3. **"Right Now" lead card on Home.** The single biggest fix to the user's "I don't know where to go" complaint, and the change that most directly delivers on the "Home is for any user" reframing.

Drop "Browse search-first" and "Single Follow button" into Polish v2 — they're high-value but each touches a flow with its own embedded behaviours, and the v1 above can ship without coupling to them.

---

## Hard rules — restated and answered

- **No code.** OK.
- **Don't redesign every screen.** Only the entry surfaces — Home, Browse tab, top bar, bottom tab bar, AES/Timu dashboard headers — are touched.
- **The Home is for ANY user, not a coach.** The "Right Now" reframing is explicitly role-agnostic; the role kicker on the hero goes away.
- **Honest about what's a real problem versus a stylistic preference.** Real problems: empty Tools tab, three confusable header pills, search trapped on MyHome, a Home that doesn't lead, an `onOpenTeam` that opens history instead of the dashboard. Stylistic preferences I declined to dress up as problems: the hero's blue colour, the section-label kicker capitalisation, the badge styles.
- **If the right answer is to remove or hide rather than add, say so.** Said so — the Tools tab should be deleted, the three header pills should be collapsed into one, the role kicker should go away, and Connections should leave MyHome for a quieter home in the hamburger.
