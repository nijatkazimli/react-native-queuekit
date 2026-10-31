import type { NetworkMonitor } from "@nijatk/react-native-queuekit";
import { netInfoMonitor } from "@nijatk/react-native-queuekit";
import NetInfo from "@react-native-community/netinfo";
import { useSyncExternalStore } from "react";

// Real connectivity (via NetInfo), plus a switch to force "offline" without leaving airplane mode on.
const real = netInfoMonitor(NetInfo);
let forcedOffline = false;
const listeners = new Set<(online: boolean) => void>();
const watchers = new Set<() => void>();

const isOnline = () => real.isOnline() && !forcedOffline;
const emit = () => {
  for (const listener of listeners) listener(isOnline());
  for (const watcher of watchers) watcher();
};

real.subscribe(emit);

export const simulatedNetwork: NetworkMonitor = {
  isOnline,
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function setForcedOffline(value: boolean) {
  forcedOffline = value;
  emit();
}

const subscribeWatch = (watcher: () => void) => {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
};

export const useForcedOffline = () => useSyncExternalStore(subscribeWatch, () => forcedOffline);
export const useOnline = () => useSyncExternalStore(subscribeWatch, isOnline);
