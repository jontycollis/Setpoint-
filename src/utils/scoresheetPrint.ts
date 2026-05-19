// ── Scoresheet PDF export ─────────────────────────────────────────────────
// Thin wrapper around `expo-print` + `expo-sharing` that turns a Tier 2
// `Match` into a printable PDF on the device and pops the system share
// sheet. HTML body comes from the pure `renderMatchScoresheetHtml`.
//
// The native modules are statically required so Metro bundles them. The
// require is still wrapped in try/catch so any unexpected runtime load
// error falls back to a friendly alert rather than crashing the screen.

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

function loadExpoPrint(): ExpoPrintModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-print');
    return (mod?.default ?? mod) as ExpoPrintModule;
  } catch {
    return null;
  }
}

function loadExpoSharing(): ExpoSharingModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-sharing');
    return (mod?.default ?? mod) as ExpoSharingModule;
  } catch {
    return null;
  }
}

/**
 * Render the match as a PDF on disk and open the system share sheet.
 * Falls back to a friendly "feature requires app update" alert if the
 * native modules aren't bundled.
 */
export async function exportMatchScoresheetPdf(match: Match): Promise<void> {
  const Print = loadExpoPrint();
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

  const Sharing = loadExpoSharing();
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
