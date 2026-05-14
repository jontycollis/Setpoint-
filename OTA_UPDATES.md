# OTA Updates — Iteration Workflow

This project ships JS/asset/theme changes via **EAS Update** (over-the-air pushes) and only does full APK builds when something native changes. This file is the playbook.

## When to OTA vs. when to build

**OTA push (`eas update`)** — safe for:
- JS source changes (any `*.ts`, `*.tsx` in `src/`, `App.tsx`, `index.ts`)
- Asset swaps (PNG/JSON in `assets/`) — but only if the asset isn't bundled into the native binary at build time
- Theme / style tweaks
- Logic fixes, copy changes, layout adjustments
- New JS-only libraries (lodash, date-fns, anything pure-JS)

**New APK build (`eas build --profile preview`)** — required for:
- New native dependency added (anything in `package.json` that ships its own iOS/Android code: `expo-camera`, `react-native-reanimated`, etc.)
- Bumping Expo SDK (`expo` major) or `react-native`
- New Android permission in `app.json` → `expo.android.permissions`
- New iOS Info.plist key
- Bumping `expo.version` in `app.json` — runtime version policy is `appVersion`, so changing this severs the OTA channel from previously-installed clients
- Editing native config files directly (rare in a managed workflow)

Rule of thumb: if you ran `npx expo install <something>` and the package adds an entry under `expo.android.permissions`, `expo.ios.infoPlist`, or has a `*.podspec` / `android/` folder in its `node_modules` directory — **you need a build**.

## Channel & runtime version

- Channel: **`preview`** (configured in `eas.json` under `build.preview.channel`)
- Runtime version policy: **`appVersion`** — every APK built off `expo.version` = `1.0.0` shares the same runtime and receives the same OTA pushes
- EAS project: `f809fef2-3bf0-4186-8619-96afe8d581b8` (slug `aes-score-tracker`)
- Update URL: `https://u.expo.dev/f809fef2-3bf0-4186-8619-96afe8d581b8`

## Day-to-day: publishing an OTA

Pre-flight checklist (the agent runs these too):

1. `npx tsc --noEmit` — must be clean
2. `npm test` — all green
3. Confirm the change is JS-only. Diff `package.json` against `master`'s last APK build commit — if there's a new dependency, is it pure JS? (Check the package's repo or `node_modules/<pkg>/android/` — if `android/` exists, it's native.)
4. No new entries under `expo.android.permissions` or `expo.ios.infoPlist`
5. `expo.version` and `runtimeVersion` unchanged
6. Do **not** bump `versionCode` for an OTA push — versionCode only bumps for new native builds

Publish:

```sh
npx eas-cli@latest update --channel preview --message "<short description of change>"
```

This prints an update ID, group ID, and runtime version. Note them down — they're how you find the update later for rollback.

## Pulling the update on the phone

Apps built with `expo-updates` check for new updates on cold start by default. So:

- **Easiest:** force-close the app, reopen. Updater fetches the new bundle in the background and applies it on the NEXT cold start. (Two cold starts to actually see the change — first fetches, second loads.)
- **Faster:** shake the device → tap **"Reload"** (works because dev menu is enabled in `preview` builds with `distribution: "internal"`)
- If the device is offline at launch, it'll grab the update next time it's online. Updates are sticky once fetched.

No settings to flip on the phone — `expo-updates` is on by default once installed.

## Rollback

```sh
npx eas-cli@latest update:rollback --channel preview
```

That points the channel back at the previous successful update. Devices pull the rollback the same way they pull any other update (next cold start).

To roll back to a specific update ID (not just one prior):

```sh
npx eas-cli@latest update:republish --update-id <id>
```

`update:republish` re-publishes a known-good past update onto the channel head, which is functionally a targeted rollback.

## Bootstrap note (history)

Through versionCode 12 the APK shipped WITHOUT `expo-updates` — there was no client to pull OTAs. versionCode 13 is the bootstrap build: it embeds `expo-updates` so every subsequent preview APK installed from versionCode 13 onward can receive OTA pushes against channel `preview`. Any device still on v12 will keep getting full APK installs forever and won't pick up OTAs.

## Agent-mode checklist

Before publishing an OTA programmatically:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test` exits 0 and all tests green
- [ ] `git diff master -- package.json` shows no new native dependency
- [ ] `git diff master -- app.json` shows no new permissions, no Info.plist additions, no `expo.version` bump, no `runtimeVersion` change
- [ ] `versionCode` NOT bumped (or, if it is, this isn't actually an OTA-able change → switch to `eas build`)
- [ ] Update message is descriptive (it shows in the EAS dashboard and helps rollback decisions later)
