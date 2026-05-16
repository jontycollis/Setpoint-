/**
 * Match notification scheduling using Expo local notifications.
 *
 * Requires: npx expo install expo-notifications
 *
 * Gracefully degrades if the module is not installed.
 */

import { formatInVenueTz } from './dates';

let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch {
  // Module not installed — notifications will be silently disabled
}

export interface MatchNotification {
  matchId: number;
  teamText: string;
  opponentText: string;
  /**
   * Match start as an epoch millisecond timestamp. The caller is expected
   * to resolve any tz ambiguity ahead of time (typically via
   * `parseScheduleTime(scheduledStart, venueTimeZone)`) so this module
   * never has to second-guess what the upstream wall-clock string meant.
   */
  scheduledStartMs: number;
  /** IANA tz of the venue, used to render the body in venue-local with a
   *  short tz name suffix ("9:00 AM EDT") rather than the user's device
   *  zone. Optional — undefined falls back to device-local rendering. */
  venueTimeZone?: string;
  courtName: string;
  eventName: string;
  divisionName: string;
}

const NOTIFICATION_CHANNEL = 'match-alerts';
const MINUTES_BEFORE = 15; // notify 15 minutes before match

/**
 * Check if notifications are available and have permission
 */
export async function areNotificationsAvailable(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Request notification permissions. Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Setup the notification channel (Android).
 */
export async function setupNotificationChannel(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
      name: 'Match Alerts',
      importance: 4, // MAX
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1a73e8',
    });
  } catch {
    // Ignore channel setup errors
  }
}

/**
 * Schedule a notification for an upcoming match (15 min before start).
 * Returns the notification identifier if scheduled, or null.
 */
export async function scheduleMatchNotification(
  match: MatchNotification
): Promise<string | null> {
  if (!Notifications) return null;

  const startTime = match.scheduledStartMs;
  if (!isFinite(startTime)) return null;
  const notifyTime = startTime - MINUTES_BEFORE * 60 * 1000;
  const now = Date.now();

  // Don't schedule if the notification time has already passed
  if (notifyTime <= now) return null;

  // Render the start time in the venue's tz with a short tz suffix so the
  // body reads "9:00 AM EDT" regardless of where the user opens it from.
  const startLabel = formatInVenueTz(startTime, match.venueTimeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${match.teamText} plays in ${MINUTES_BEFORE} min`,
        body: `vs ${match.opponentText} @ ${startLabel}\n${match.courtName} · ${match.divisionName}`,
        data: {
          matchId: match.matchId,
          type: 'match-reminder',
        },
        categoryIdentifier: NOTIFICATION_CHANNEL,
      },
      trigger: {
        type: 'date',
        date: new Date(notifyTime),
        channelId: NOTIFICATION_CHANNEL,
      },
    });
    return id;
  } catch (err) {
    console.warn('Failed to schedule notification:', err);
    return null;
  }
}

/**
 * Cancel a previously scheduled notification by its identifier.
 */
export async function cancelNotification(id: string): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Ignore
  }
}

/**
 * Cancel all scheduled match notifications.
 */
export async function cancelAllNotifications(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Ignore
  }
}

/**
 * Get all currently scheduled notifications.
 */
export async function getScheduledNotifications(): Promise<any[]> {
  if (!Notifications) return [];
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    return [];
  }
}

/**
 * Schedule notifications for all upcoming matches.
 * First cancels existing ones, then schedules new ones.
 * Returns the count of scheduled notifications.
 */
export async function scheduleAllMatchNotifications(
  matches: MatchNotification[]
): Promise<number> {
  if (!Notifications) return 0;

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return 0;

  await setupNotificationChannel();

  // Cancel all existing to avoid duplicates
  await cancelAllNotifications();

  let count = 0;
  for (const match of matches) {
    const id = await scheduleMatchNotification(match);
    if (id) count++;
  }

  return count;
}
