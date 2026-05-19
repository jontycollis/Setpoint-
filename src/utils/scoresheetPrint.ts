// ── Scoresheet PDF export ─────────────────────────────────────────────────
//
// Thin wrapper around `expo-print` + `expo-sharing` that turns a Tier 2
// `Match` into a printable PDF on the device and pops the system share
// sheet so the user can save / send it. The HTML body is produced by
// `renderMatchScoresheetHtml` — that module is pure and can be tested
// without native deps; this one is the IO edge.
//
// ────────────────────────────────────────────────────────────────────────────
// Native-module status:
//   `expo-print` and `expo-sharing` are NATIVE modules — they bring
//   Android `PrintManager` / iOS `UIPrintInteractionController` bindings
//   that have to be linked into the binary. As of this commit they are
//   NOT in `package.json`, so the running APK does not contain them.
//   The button that calls into this module will therefore fall through
//   to a friendly "Update the app" alert on every device until a new
//   APK ships with the deps added.
//
//   To enable PDF export end-to-end:
//     1. `yarn add expo-print expo-sharing` (or the Expo SDK matrix
//        version pinned to expo ~54).
//     2. Rebuild the Android binary (`eas build --platform android`
//        OR a local prebuild + Gradle build).
//     3. Distribute the new APK. After that, this module just works
//        — no code changes needed (the lazy require below picks the
//        native modules up automatically).
//
// We use `require()` instead of `import` so the TypeScript compiler
// doesn't fail when the modules aren't installed, and the JS bundler
// (Metro) can still build a debug-OTA without the native code.

import { Alert } from 'react-native';
import type { Match } from '../types/match';
import { renderMatchScoresheetHtml } from './scoresheetHtml';

interface ExpoPrintModule {
  printToFileAsync: (opts: { html: string }) => Promise<{ uri: string }>;
}

interface ExpoSharingModule {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string, opts?: { mimeType?: string; UTI?: string; dialogTitle?: string }) => Promise<void>;
}

function safeRequire<T>(modName: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modName);
    return (mod?.default ?? mod) as T;
  } catch {
    return null;
  }
}

/**
 * Render the match as a PDF on disk and open the system share sheet.
 * Falls back to a friendly "feature requires app update" alert if the
 * native modules aren't bundled (see file header).
 */
export async function exportMatchScoresheetPdf(match: Match): Promise<void> {
  const Print = safeRequire<ExpoPrintModule>('expo-print');
  if (!Print || typeof Print.printToFileAsync !== 'function') {
    Alert.alert(
      'PDF export requires an app update',
      'Printing the scoresheet uses a feature that ships with the next app build. The match data is preserved — you can export once the update lands.'
    );
    return;
  }

  let pdfUri: string;
  try {
    const html = renderMatchScoresheetHtml(match);
    const result = await Print.printToFileAsync({ html });
    pdfUri = result.uri;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    Alert.alert('Could not generate PDF', msg);
    return;
  }

  const Sharing = safeRequire<ExpoSharingModule>('expo-sharing');
  if (!Sharing || typeof Sharing.shareAsync !== 'function') {
    Alert.alert('PDF saved', `Generated at:\n${pdfUri}`);
    return;
  }

  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('PDF saved', `Generated at:\n${pdfUri}`);
      return;
    }
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Share scoresheet',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    Alert.alert('Sharing unavailable', `PDF saved to: ${pdfUri}\n\n${msg}`);
  }
}
