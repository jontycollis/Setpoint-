# Bior

Mobile companion for indoor volleyball coaches, athletes, and parents — tournament browsing, team dashboards, live scoring, season history, and venue maps for Volleyball Canada / OVA / AES-hosted events.

Built with **React Native + Expo SDK 54**.

## Quick start

```sh
# Install deps
npm install

# Run the dev server (Metro)
npx expo start

# Run on a connected device
#   Android: scan QR with Expo Go, or `npx expo start --android`
#   iOS:     scan QR with Camera app, or `npx expo start --ios`
```

## Tests

```sh
npm test              # one-shot
npm run test:watch    # watch mode
```

The test suite (Vitest) covers pure-TS utilities: scoring engine, win probability, season-team identity, WebView URL helpers. RN screens / components aren't unit-tested (Vitest is Node-only here; an RN-aware runtime would be a separate setup).

## Build + ship

This project uses **EAS Build** and **EAS Update**. See `OTA_UPDATES.md` for the full workflow.

```sh
# Native build (APK with expo-updates bundled, ships to phone via the
# preview install link)
eas build --profile preview --platform android

# OTA push (JS / asset / theme changes only — no native deps)
npx eas-cli@latest update --channel preview --message "<short note>"
```

Bump `expo.android.versionCode` in `app.json` whenever a native rebuild is needed (new package with native code, new permission, new bundled asset). Don't bump it for OTA pushes.

## Project structure

```
App.tsx                       Root navigation + screen switch
src/
  screens/                    One file per top-level screen (~30 screens)
  components/                 Reusable RN components (Card, HamburgerMenu, etc.)
  config/
    tournaments.ts            Country → Tournament → Year → Event registry
  utils/
    theme.ts                  Light/dark palettes, spacing, font sizes
    webViewUrls.ts            URL helpers shared by WebView screens
    matchEngine.ts            Tier-2 scoring engine
    winProbability.ts         In-set win probability math
    seasonTeamIdentity.ts     Cross-tournament team identity / aliases
    __tests__/                Vitest specs for the above
  api/                        AES + Timu + venue-map discovery clients
assets/                       Icon, splash, bundled venue maps
```

## Integrations

The app embeds three third-party services. Bior is **not affiliated** with any of them — see `PRIVACY.md` and the in-app "About" screen for the full disclaimer.

| Integration | What it is | How Bior uses it |
|---|---|---|
| **AES** (Advanced Event Systems, `results.advancedeventsystems.com`) | Tournament results / brackets API used by Volleyball Canada and OVA | Public read-only fetch of tournament metadata, divisions, teams, schedules |
| **OVA MRS** (`mrs.ontariovolleyball.org`) | Ontario Volleyball Association member registration system | Embedded WebView — user signs in with their own credentials; Bior never sees them |
| **CAC Locker** (`thelocker.coach.ca`) | Coaching Association of Canada certification dashboard | Same — embedded WebView for the user's own session |

For MRS and CAC, Bior injects display-only CSS to make the desktop layouts legible on a phone. No data is scraped, exfiltrated, or stored on a server (because there is no Bior server — see the next section).

## Data + privacy

Bior is a **client-only app**. There is no backend, no user accounts, no telemetry server. Everything is local to the device:

- Match scores, team rosters, favorite tournaments → `AsyncStorage` on the device only.
- MRS / CAC WebView sessions → standard cookie store inside the WebView, scoped to the embedded site.
- AES tournament data → fetched on-demand from public endpoints; cached locally.
- Crash reports / analytics → **none** at the moment (this will change with the Sentry rollout for production builds).

See `PRIVACY.md` for the user-facing privacy policy.

## License

See `LICENSE`. (Currently proprietary — internal use only.)
