import { createQueue, netInfoMonitor } from "@nijatk/react-native-queuekit";
import NetInfo from "@react-native-community/netinfo";
import { createMMKV } from "react-native-mmkv";

// Jobs are declared next to their feature with queue.define() (see ./features).
export const queue = createQueue({
  storage: createMMKV({ id: "queuekit" }),
  network: netInfoMonitor(NetInfo),
  concurrency: 2,
  timeoutMs: 60_000,
  retry: { maxAttempts: 6, baseDelayMs: 2_000 },
});
