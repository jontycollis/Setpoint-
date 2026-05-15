// ── useNetworkStatus hook ─────────────────────────────────────────────────
//
// Wrapper around `@react-native-community/netinfo`'s `addEventListener`
// that returns the current network status as a React-friendly boolean.
// Used by the global OfflineBanner and by any screen that wants to
// show an "offline" empty state on its data fetches.
//
// Why a hook and not just inline NetInfo calls:
//   1) React-y consumption — components re-render automatically when
//      connectivity changes without each one wiring its own listener.
//   2) Memoisation in one place — NetInfo fires "connected" events
//      frequently (e.g. when the radio momentarily flutters); we
//      debounce those here so a flap doesn't trigger a flood of
//      re-renders downstream.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import NetInfo, {
  NetInfoState,
  NetInfoStateType,
} from '@react-native-community/netinfo';

export interface NetworkStatus {
  /** True when we have an internet-capable connection. NetInfo
   *  distinguishes "connected to a network" from "that network
   *  reaches the internet" — we treat reachability=null as online
   *  (NetInfo hasn't finished probing yet) but reachability=false
   *  as offline. */
  online: boolean;
  /** Connection type as reported by NetInfo. Useful for showing
   *  "you're on cellular — image loads may be slow" hints later. */
  type: NetInfoState['type'];
}

const DEBOUNCE_MS = 1500;

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    // Optimistic default — assume online until told otherwise. Avoids
    // a one-frame "offline" flash on cold start while NetInfo runs
    // its first reachability probe.
    online: true,
    type: NetInfoStateType.unknown,
  });

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingOnline: boolean | null = null;

    const unsubscribe = NetInfo.addEventListener((s) => {
      const next = isOnline(s);

      // First event arrives immediately — apply it without delay so
      // the initial state reflects reality.
      if (pendingOnline === null) {
        pendingOnline = next;
        setStatus({ online: next, type: s.type });
        return;
      }

      // Subsequent events are debounced — a flapping connection
      // shouldn't blast re-renders.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        pendingOnline = next;
        setStatus({ online: next, type: s.type });
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  return status;
}

function isOnline(s: NetInfoState): boolean {
  if (s.isConnected === false) return false;
  // isInternetReachable is null while NetInfo is still probing — we
  // default to "online" so we don't flash an offline banner during
  // the initial check.
  if (s.isInternetReachable === false) return false;
  return true;
}
