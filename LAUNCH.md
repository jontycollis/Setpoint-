# Launch checklist — Bior v1.0

Pre-submission tracker covering Play Store + App Store. All code-side work for v1.0 launched in commits leading up to versionCode 14; this file is the human-side punch list + the canonical source for store-listing copy and review-team answers.

---

## 1. Build + install the v14 APK

```sh
eas build --profile preview --platform android
```

This is the **bootstrap** build that first carries:
- expo-updates (OTA channel: `preview`)
- @sentry/react-native (crash reporter)
- @react-native-community/netinfo (offline banner)
- iOS Privacy Manifest declarations
- Dark-mode-follows-OS

Once installed, all subsequent JS-only iterations ship via:
```sh
npx eas-cli@latest update --channel preview --message "<short note>"
```

See `OTA_UPDATES.md` for the full workflow.

## 2. Configuration placeholders to fill before submission

These three placeholders are in code. Search-and-replace each before submitting.

| Where | Placeholder | Replace with |
|---|---|---|
| `src/utils/sentryInit.ts` → `SENTRY_DSN` | `''` | Real Sentry DSN (see §3) |
| `src/screens/AboutScreen.tsx` → `PRIVACY_POLICY_URL` | `''` | Hosted privacy-policy URL (see §4) |
| `src/screens/AboutScreen.tsx` → `SUPPORT_EMAIL` | `'TBD@example.com'` | Real contact email |
| `src/components/ErrorBoundary.tsx` → mailto: link | `'TBD@example.com'` | Same contact email |
| `PRIVACY.md` → "TBD@example.com" everywhere | placeholder | Real contact email |
| `PRIVACY.md` → "_Effective date: TBD_" | placeholder | Actual effective date (typically the submission date) |
| `PRIVACY.md` → "_Last reviewed: TBD._" | placeholder | Same date or close to it |

Once those four files are updated, every later OTA push ships them automatically — no rebuild required.

## 3. Sentry setup

1. Sign up at https://sentry.io (free tier covers 5K events/month — plenty for launch).
2. Create a new project → React Native platform → name "Bior".
3. Copy the **DSN** from Project Settings → Client Keys.
4. Paste into `src/utils/sentryInit.ts` → `SENTRY_DSN`.
5. Commit + OTA push. Production crashes start appearing in the Sentry dashboard.

**No source maps wiring yet** — that's a follow-up. Without source maps Sentry's stack traces show minified function names, which is workable for the first few releases.

## 4. Hosting the privacy policy

Apple + Google both require a **publicly accessible URL** for the privacy policy, linked from the store listing AND from inside the app. Easiest options ranked by effort:

| Option | Effort | Notes |
|---|---|---|
| **GitHub Pages** | 15 min | Push `PRIVACY.md` to a public repo, enable Pages → site auto-renders Markdown. URL pattern: `https://<user>.github.io/<repo>/privacy.html` |
| **Notion / Google Docs (public link)** | 5 min | Quick but looks unbranded. Use Notion's "Publish to web". |
| **Your own domain** | depends | Most polished long-term but requires DNS / hosting work. |

Whichever you pick, paste the URL into `AboutScreen.tsx` → `PRIVACY_POLICY_URL` so the in-app "Read full privacy policy" button opens it.

## 5. Store listing copy

Below is launch-ready copy for both stores. Adjust voice as you like.

### 5.1 App name + tagline

- **App name (both stores):** Bior
- **Subtitle (App Store, ≤30 chars):** Volleyball tournaments & scoring
- **Short description (Play Store, ≤80 chars):** Tournament browser, team dashboards, and live scoring for indoor volleyball.

### 5.2 Long description

Use this for both Play Store (≤4000 chars) and App Store (≤4000 chars). Trim if needed.

```
Bior is a companion app for indoor volleyball coaches, athletes,
and parents. Browse tournaments from AES, OVA, and Timu, follow your
team across the season, score matches live, and find your court at
the venue — all in one place.

KEY FEATURES
• Tournament browser — Ontario Championships, Canadian Nationals,
  USAV events, and Timu tournaments, organized by year.
• Team dashboards — standings, brackets, court schedules, season
  history, and upcoming matches in one tap.
• Live scoring — a hold-it-across-the-gym scoreboard for casual play
  plus a paper-fidelity scoring mode with rotation tracking, libero
  swaps, and post-match stats.
• Venue maps — pinch-to-zoom venue maps for all the major Canadian
  tournaments, including the 2026 Youth Nationals (Mississauga,
  Calgary, Edmonton, Moncton, Ottawa).
• OVA MRS + CAC Locker connectors — sign in to your membership and
  coaching portals inside Bior via embedded web views. Your
  credentials stay with the service — Bior never sees them.
• Offline-friendly — recent tournament data is cached so the app
  works on the venue's wonky Wi-Fi.

PRIVACY-FIRST
Bior is a client-only app. There's no Bior server, no user
account, and no behavioural analytics. Match scores, team rosters,
and favorites stay on your device. See the in-app About & Privacy
screen for full details.

NOT AFFILIATED
Bior is an independent companion tool. It is not affiliated with,
endorsed by, or sponsored by Volleyball Canada, the Ontario Volleyball
Association, the Coaching Association of Canada, Advanced Event
Systems, or Timu Sports. All trademarks and tournament data are the
property of their respective owners.
```

### 5.3 Keywords (App Store, ≤100 chars total, comma-separated)

```
volleyball,scoreboard,tournament,AES,OVA,Nationals,coach,team,stats,scoring,club
```

### 5.4 Category

- **Play Store:** Sports
- **App Store:** Sports

### 5.5 Age rating

Both stores: **Everyone / 4+** (no adult content, no UGC, no in-app purchases, no chat). The IARC / Apple questionnaires below give the verbatim answers.

## 6. Google Play Console — Data Safety form

Play Console asks a question-by-question form. Verbatim answers below — these MUST match what `PRIVACY.md` says.

### Data collection + sharing

> **Does your app collect or share any of the required user data types?**
**Yes — crash diagnostics only.** Bior sends anonymized crash reports to Sentry. No other data collection.

### Data types (per-category)

For every category EXCEPT "App activity → Crashlogs / Diagnostics":
> **Collected:** No
> **Shared:** No

For "App activity → Crashlogs and Diagnostics":
> **Collected:** Yes
> **Shared:** No (sent to Sentry under our infrastructure provider; not shared with third parties)
> **Required or optional:** Required (necessary for app functionality)
> **Encrypted in transit:** Yes (HTTPS)
> **User can request deletion:** Yes (contact via support email)
> **Purpose:** App functionality, Analytics — specifically crash diagnostics

### Security practices

- ✅ **Data is encrypted in transit** (HTTPS to all endpoints).
- ✅ **You can request that data be deleted.** (Email request — Sentry retains 90 days by default.)
- ✅ **Committed to follow Play Families Policy** — N/A (no children's app designation).

## 7. Apple App Store — App Privacy + Review notes

Apple's privacy nutrition labels + the review-team notes.

### 7.1 App Privacy labels (App Store Connect → App Privacy)

For every category EXCEPT "Diagnostics → Crash Data":
> **Not Collected.**

For "Diagnostics → Crash Data":
> **Used to improve app functionality** (Sentry).
> **Not linked to the user's identity.** (Sentry is configured to drop IPs in `beforeSend`.)
> **Not used for tracking.**

### 7.2 App Review Information notes (paste into the review-notes field)

```
Bior is a companion app for indoor volleyball. It surfaces public
tournament data from Advanced Event Systems (AES) and Timu, and
embeds the OVA MRS and CAC Locker member portals as web views so
users can manage their existing memberships inside the app.

Bior is NOT affiliated with, endorsed by, or sponsored by:
  Volleyball Canada / Ontario Volleyball Association /
  Coaching Association of Canada / Advanced Event Systems / Timu.

The in-app About & Privacy screen (reachable from the hamburger
menu) makes this disclaimer prominent. The first-launch onboarding
flow also surfaces it before the user reaches any other screen.

CREDENTIALS
The MRS and CAC Locker screens embed the third-party sign-in pages
directly. Credentials are entered into the web view and stay in the
web view's cookie store — Bior never reads, captures, stores,
or transmits the user's username or password.

DEMO ACCOUNT
No demo account is needed to test the app. Tournament browsing and
the live scoreboard work without any sign-in. To test the MRS/CAC
connectors, reviewers can decline the sign-in prompt and use the
in-app navigation toolbar at the bottom of the WebView to navigate
back.

DATA COLLECTION
No personal data is collected. The only outbound traffic outside of
public tournament data fetches is anonymized crash reports to
Sentry. See https://<HOSTED-PRIVACY-POLICY-URL> for the full policy.

NOT TARGETED AT CHILDREN
The app surfaces youth volleyball tournament data but is targeted
at coaches, parents, and adult athletes managing the team. There is
no signup, no chat, no UGC, and no advertising.
```

### 7.3 Encryption export compliance

`ITSAppUsesNonExemptEncryption: false` is already set in `app.json`. Reviewers may still ask — the app uses only standard HTTPS, no proprietary cryptography.

## 8. Screenshots

Both stores require multiple sizes. Easiest workflow:

1. Run the app on a phone or simulator.
2. Capture the screens listed below.
3. Use https://screenshots.pro or https://app.previewed.app to resize + add device frames.

### 8.1 Required sizes

**Play Store (Android):**
- Phone: at least 2 screenshots, 16:9 or 9:16, min 320px / max 3840px on the long edge
- 7" tablet: optional but improves listing
- 10" tablet: optional

**App Store (iOS):**
- 6.7" iPhone (1290 × 2796): at least 3 screenshots
- 6.5" iPhone (1242 × 2688): at least 3 screenshots
- 5.5" iPhone (1242 × 2208): at least 3 screenshots
- iPad 12.9" (2048 × 2732): at least 3 screenshots (only required if `supportsTablet: true` — which we have)

### 8.2 Recommended screenshots (in order)

Capture these in order so the listing tells a story:

1. **MyHome with a team card** — shows "Following X teams, upcoming matches, recently viewed."
2. **Team Dashboard** — standings + upcoming-tournament cards.
3. **Standings or Brackets** — live tournament data.
4. **Scoreboard (Tier 1, landscape)** — the hold-it-up scoreboard mid-match.
5. **Venue Map** — pinch-to-zoom map of one of the 2026 Nationals cities.
6. *(optional 6th)* **About / Disclaimer screen** — reinforces "official tournament data, unaffiliated companion app" for reviewers.

Use real data on a populated tournament for the most visual impact.

## 9. Post-submission monitoring

Once approved + live:

- **Sentry** — watch the issues feed for new error spikes; new releases will show up tagged by versionCode.
- **Play Console "Android Vitals"** — ANR + crash rate. Apple App Store Connect → Analytics gives the same.
- **Reviews** — both stores. First few weeks of reviews flag the visible bugs reviewers couldn't reproduce in QA.
- **OTA cadence** — JS-only fixes can ship daily via `eas update --channel preview` once you graduate to a separate `production` channel; native changes (Sentry version bump, etc.) require new APK + Play Console rollout.

## 10. Open items (deferred from v1.0)

| Item | Why deferred | When |
|---|---|---|
| **French localization** | Adds week+ of translation effort; no working framework yet | v1.1 |
| **Tablet-specific layouts** | `supportsTablet: true` works but isn't tuned | v1.1 |
| **Push notifications wired to a use case** | Module is in but no notification UX yet | v1.1 |
| **iOS build** | Requires Apple Developer Program signup | After Android lands |
| **Sentry source maps** | Manual upload to Sentry per release | v1.1 |
| **`autoIncrement: true` on preview profile** | Currently only production has this | When preview gets noisy |
| **OVA / CAC ToS conversations** | Embedded-WebView usage is a gray area | Send the emails before broad public launch |
