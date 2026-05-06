// ── Shared Timu UI ──────────────────────────────────────────────────────────
//
// Components used by both TimuTournamentScreen and TimuTeamDashboardScreen:
//   • VenueInfoCard        — expandable venue details pulled from the Timu page
//   • ContactButtonsRow    — tappable host / venue / OVA contacts
//   • OvaDocsSheet         — modal with Ontario Volleyball Association PDFs
//   • TimuShareButton      — native Share sheet with tournament link
// ────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
  ScrollView,
  Share,
  Platform,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { Card } from './Card';
import type { TimuTournamentInfo } from '../types/timu';
import { TIMU_DOC_URLS, OVA_CONTACTS } from '../api/timuClient';

// ── Venue Info card ───────────────────────────────────────────────────────

interface VenueInfoProps {
  info: TimuTournamentInfo;
}

export function VenueInfoCard({ info }: VenueInfoProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  if (!info.venueName && !info.notes) return null;

  return (
    <Card variant="outlined" style={styles.venueCard}>
      <TouchableOpacity onPress={() => setExpanded((x) => !x)} activeOpacity={0.7}>
        <View style={styles.venueHeader}>
          <View style={styles.venueHeaderLeft}>
            <Text style={styles.venueIcon}>{'\u{1F4CD}'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.venueTitle}>{info.venueName || 'Venue'}</Text>
              {info.venueAddress ? (
                <Text style={styles.venueAddress} numberOfLines={2}>
                  {info.venueAddress}
                </Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.chev}>{expanded ? '\u2303' : '\u2304'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.venueBody}>
          {info.venueAddress ? (
            <TouchableOpacity
              style={styles.venueAction}
              onPress={() => openMapsFor(info.venueAddress!)}
            >
              <Text style={styles.venueActionText}>Open in Maps</Text>
            </TouchableOpacity>
          ) : null}
          {info.notes ? (
            <Text style={styles.venueNotes}>{info.notes}</Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function openMapsFor(address: string) {
  const q = encodeURIComponent(address);
  // iOS prefers apple maps; Android users land on Google Maps with query.
  const url = Platform.select({
    ios: `http://maps.apple.com/?q=${q}`,
    default: `https://www.google.com/maps/search/?api=1&query=${q}`,
  })!;
  Linking.openURL(url).catch(() =>
    Alert.alert('Unable to open maps', 'Please copy the address manually.')
  );
}

// ── Contact buttons ───────────────────────────────────────────────────────

interface ContactButtonsProps {
  info: TimuTournamentInfo;
}

export function ContactButtonsRow({ info }: ContactButtonsProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const contacts: Array<{ label: string; action: () => void }> = [];
  if (info.hostContact) {
    contacts.push({
      label: 'Host',
      action: () => openMail(info.hostContact!, 'Tournament question'),
    });
  }
  if (info.venueContact && info.venueContact !== info.hostContact) {
    contacts.push({
      label: 'Venue',
      action: () => openMail(info.venueContact!, 'Venue question'),
    });
  }
  contacts.push({
    label: 'OVA',
    action: () => Linking.openURL(OVA_CONTACTS.hotline).catch(() => {}),
  });

  if (contacts.length === 0) return null;

  return (
    <View style={styles.contactRow}>
      {contacts.map((c) => (
        <TouchableOpacity
          key={c.label}
          style={styles.contactBtn}
          onPress={c.action}
          activeOpacity={0.7}
        >
          <Text style={styles.contactLabel}>{c.label}</Text>
          <Text style={styles.contactAction}>Contact</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function openMail(email: string, subject: string) {
  const url = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
  Linking.openURL(url).catch(() =>
    Alert.alert('Cannot open email', `Please email ${email} manually.`)
  );
}

// ── OVA Docs Sheet (modal) ────────────────────────────────────────────────

const OVA_DOCS: Array<{ label: string; url: string; desc?: string }> = [
  { label: "What's New 2025–26", url: TIMU_DOC_URLS.whatsNew },
  { label: 'Youth Competitions Manual', url: TIMU_DOC_URLS.youthManual, desc: 'Full policy reference' },
  { label: 'Tie-Breaking Rules', url: TIMU_DOC_URLS.tieBreaker, desc: 'YCM §5.7' },
  { label: 'Purple Card', url: TIMU_DOC_URLS.purpleCard, desc: 'YCM p.59' },
  { label: 'Protest Procedure', url: TIMU_DOC_URLS.protest, desc: 'YCM p.58' },
  { label: 'Concussion Policy', url: TIMU_DOC_URLS.concussion },
  { label: 'MRS Roster Verification', url: TIMU_DOC_URLS.mrsRoster },
  { label: 'ECI Manual', url: TIMU_DOC_URLS.eci },
  { label: 'How To Score', url: TIMU_DOC_URLS.howToScore, desc: 'Volleyball Canada' },
  { label: 'Scoresheet — 4v4', url: TIMU_DOC_URLS.scoresheet4v4 },
  { label: 'Scoresheet — 6v6', url: TIMU_DOC_URLS.scoresheet6v6 },
  { label: 'Scoresheet — Best of 3', url: TIMU_DOC_URLS.scoresheet2of3 },
];

interface DocsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function OvaDocsSheet({ visible, onClose }: DocsSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalPanel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>OVA Documents</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {OVA_DOCS.map((d) => (
              <TouchableOpacity
                key={d.url}
                style={styles.docRow}
                onPress={() => {
                  Linking.openURL(d.url).catch(() =>
                    Alert.alert('Cannot open document', d.url)
                  );
                }}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.docLabel}>{d.label}</Text>
                  {d.desc ? <Text style={styles.docDesc}>{d.desc}</Text> : null}
                </View>
                <Text style={styles.docChev}>{'>'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Share button ──────────────────────────────────────────────────────────

interface ShareProps {
  tid: number;
  tournamentName: string;
  style?: any;
  tint?: 'light' | 'dark';
}

export function TimuShareButton({ tid, tournamentName, style, tint = 'dark' }: ShareProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  async function onShare() {
    try {
      await Share.share({
        message: `${tournamentName} — Timu scoreboard: https://www.timu.ca/scoreboards/schedule.php?tid=${tid}`,
        url: `https://www.timu.ca/scoreboards/schedule.php?tid=${tid}`,
      });
    } catch {
      // ignored — user may have cancelled
    }
  }
  const light = tint === 'light';
  return (
    <TouchableOpacity style={[styles.shareBtn, light && styles.shareBtnLight, style]} onPress={onShare} activeOpacity={0.7}>
      <Text style={[styles.shareBtnText, light && styles.shareBtnTextLight]}>Share</Text>
    </TouchableOpacity>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  venueCard: {},
  venueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  venueHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  venueIcon: { fontSize: 20, marginRight: spacing.sm },
  venueTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  venueAddress: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  chev: { fontSize: 18, color: colors.textLight, marginLeft: spacing.sm },
  venueBody: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  venueAction: {
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  venueActionText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
  venueNotes: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20 },

  contactRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  contactBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactLabel: { fontSize: fontSize.xs, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactAction: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700', marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalPanel: {
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  modalClose: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  docLabel: { fontSize: fontSize.md, color: colors.text, fontWeight: '600' },
  docDesc: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  docChev: { fontSize: 18, color: colors.textLight },

  shareBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.sm,
  },
  shareBtnLight: { backgroundColor: colors.primaryLight },
  shareBtnText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '600' },
  shareBtnTextLight: { color: colors.primary },
});
}
