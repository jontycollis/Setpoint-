# SetPoint — Privacy Policy

_Effective date: 2026-05-15._
_Last reviewed: 2026-05-15._

This document describes how the **SetPoint** mobile app ("SetPoint", "the app", "we", "us") handles your data. SetPoint is built and operated by Jon Collis ("the developer"). Contact: **jontycollis@gmail.com**.

> **SetPoint is not affiliated with, endorsed by, or sponsored by** Volleyball Canada, the Ontario Volleyball Association (OVA), the Coaching Association of Canada (CAC), Advanced Event Systems (AES), or Timu Sports. The app is a third-party companion tool that surfaces public data and embeds those services' own member portals as web views.

## Quick summary

- SetPoint is a **client-only app**. There is no SetPoint server, no SetPoint account, and no SetPoint telemetry.
- All data the app creates or downloads — match scores, team rosters, favorite tournaments, AES tournament caches — lives on your device only.
- When you sign in to **OVA MRS** or **CAC Locker** inside the app, your credentials go directly to those services through an embedded web view. **SetPoint never sees, captures, or stores your username or password.**
- Crash reports (Sentry) collect technical information about errors — not your name, location, or personal data. Crash reporting is on by default in production builds; the in-app About screen will let you disable it.

## What's stored, where it lives, and why

### On-device only (AsyncStorage)

The app stores the following on your device. Nothing in this list ever leaves the device under SetPoint's control:

- **Followed teams + tournaments** — the list you see in the home / hamburger menu.
- **Match scores you've recorded** — Tier 1 scoreboard sessions and Tier 2 scored matches, including event log replay state.
- **Roster + lineup history** — players you've added to teams, lineup rotations, etc.
- **Season-history aliases + identity links** — the cross-tournament team-identity registry that powers "Season History".
- **Connection flags** — booleans noting whether you've previously signed in to MRS or CAC (so we can show the right "Connected" badge). The actual session is held by the embedded web view's own cookie store, not by SetPoint.
- **Captured profile URL for CAC Locker** — once you navigate to your coach detail page once, the URL is saved so subsequent logins jump straight there. It does not include any credentials or session tokens.
- **Onboarding-completed flag, recently-viewed strip, last-refresh timestamps** — UX state.

You can erase all of this at any time by uninstalling the app or, for individual items, by using the in-app "remove" / "disconnect" / "reset" actions.

### Embedded web views (OVA MRS, CAC Locker)

The app embeds the OVA MRS and CAC Locker websites via a `WebView`. When you use those screens:

- You sign in directly with the service. SetPoint **does not capture, log, or transmit** your username, password, or session cookie. The cookie is held by the platform's web view component and scoped to that site only.
- SetPoint injects **display-only CSS** to make the desktop layouts more readable on a phone. SetPoint does not modify, extract, or repost content from those sites.
- The "Disconnect" button inside SetPoint clears the connection flag described above. To fully sign out, also tap the service's own Sign Out before disconnecting.

### Public tournament data (AES, Timu)

The app fetches **public tournament results and metadata** from `results.advancedeventsystems.com` and Timu Sports. This is the same data anyone can see by visiting those sites in a browser. The fetched data is cached on your device so the app works on weak connections; it is not transmitted to any SetPoint server.

### Crash and error reporting (Sentry)

Production builds of SetPoint include **Sentry** for crash reporting. When the app crashes or hits an unhandled error, Sentry records:

- A stack trace of the crash.
- Anonymized device metadata: OS version, device model, app version.
- Recent in-app navigation breadcrumbs (e.g. "opened Scoreboard", "tapped Disconnect").

Sentry does **not** receive your name, MRS/CAC credentials, team rosters, match scores, or any of the on-device data described above. We use it solely to fix bugs.

### Analytics

The current production build does **not** include any user-behavior analytics (no Mixpanel, Amplitude, Firebase, Google Analytics, etc.). If this changes, this policy will be updated and you will be notified in-app.

### Push notifications

The app declares the `expo-notifications` capability but does not currently register for or send any push notifications. If this changes, you will be prompted for permission and this policy will be updated to describe what's sent.

## What's NOT stored

- We do **not** store your MRS / CAC credentials.
- We do **not** store your AES login or session token (AES integration is read-only, public-data only).
- We do **not** store your real name, email, phone, or location.
- We do **not** track your physical location.
- We do **not** sell, share, license, or sublicense any data to anyone.

## Permissions the app requests

| Permission | Why |
|---|---|
| **Internet** | To fetch public AES tournament data and to load the OVA MRS / CAC Locker pages inside the web view. |
| **Notifications** _(future)_ | If/when we wire up reminders for match-start times. Not active in the current build. |

No other permissions are requested.

## Children's privacy

SetPoint surfaces public tournament data for youth volleyball events, but does not knowingly collect data from anyone, including children. There is no account, no signup, and no on-device data is transmitted off-device under our control.

## Data retention

Because everything is local to your device:

- Data persists until you uninstall the app or use the relevant in-app remove / disconnect / reset action.
- Sentry crash reports are retained per Sentry's standard retention (currently 90 days).
- We do not maintain backups of your device data on any SetPoint-controlled server (there is no such server).

## Your rights

Because we hold no personal data on any server, the standard "delete my data" request resolves to "uninstall the app".

For data SetPoint receives via Sentry (anonymized crash traces), you may contact us to request deletion: **jontycollis@gmail.com**.

## Changes to this policy

We may update this policy from time to time. The "Effective date" and "Last reviewed" fields at the top of the document reflect the current version. Material changes will be surfaced in-app via the About / Disclaimer screen before they take effect.

## Contact

Questions about this policy: **jontycollis@gmail.com**.
