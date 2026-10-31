import { useJobs, useQueue, useQueueStats } from "@nijatk/react-native-queuekit/react";
import { Button, Text, View } from "react-native";

// Drop-in banner: hidden when idle, otherwise shows progress and a retry-all action.
export function SyncBanner() {
  const queue = useQueue();
  const { pending, active, failed } = useQueueStats();
  const failedJobs = useJobs({ status: "failed" });

  if (pending + active + failed === 0) return null;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 12 }}>
      <Text style={{ flex: 1 }}>
        {failed > 0
          ? `${failed} item${failed > 1 ? "s" : ""} couldn't sync`
          : `Syncing ${pending + active} item${pending + active > 1 ? "s" : ""}…`}
      </Text>
      {failed > 0 && (
        <Button
          title="Retry all"
          onPress={() => {
            for (const job of failedJobs) queue.retry(job.id);
          }}
        />
      )}
    </View>
  );
}
