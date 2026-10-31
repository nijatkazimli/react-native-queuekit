/**
 * Source of connectivity information. Implement it to plug in any network
 * library, or use `netInfoMonitor` for `@react-native-community/netinfo`.
 */
export interface NetworkMonitor {
  /** Current connectivity. Read when the queue starts. */
  isOnline(): boolean;
  /**
   * Call `listener` whenever connectivity changes.
   *
   * @returns A function that unsubscribes.
   */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Default monitor: always reports online, so `requiresNetwork` never holds a job back. */
export const alwaysOnline: NetworkMonitor = {
  isOnline: () => true,
  subscribe: () => () => {},
};

interface NetInfoLike {
  addEventListener(
    listener: (state: {
      isConnected: boolean | null;
      isInternetReachable?: boolean | null;
    }) => void,
  ): () => void;
}

/**
 * Adapts `@react-native-community/netinfo` to a `NetworkMonitor`. The device counts
 * as online unless NetInfo reports it disconnected or the internet unreachable.
 *
 * @param netInfo - The NetInfo default export.
 * @example
 * import NetInfo from '@react-native-community/netinfo';
 * createQueue({ storage, network: netInfoMonitor(NetInfo) });
 */
export function netInfoMonitor(netInfo: NetInfoLike): NetworkMonitor {
  let online = true;
  return {
    isOnline: () => online,
    subscribe: (listener) =>
      netInfo.addEventListener((state) => {
        online = state.isConnected !== false && state.isInternetReachable !== false;
        listener(online);
      }),
  };
}
