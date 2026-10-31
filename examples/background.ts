// Illustrates the pattern with expo-background-task; adapt it to your background-task library.

import { flushOnForeground } from "@nijatk/react-native-queuekit";
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";
import { queue } from "./queue";
import "./features"; // the headless task has no UI, so handlers must be registered here too

const TASK = "queuekit-drain";

// Must be defined at module scope so the OS can start it without the UI.
TaskManager.defineTask(TASK, async () => {
  try {
    // The OS gives roughly 30 seconds; stop waiting a little before that.
    await queue.drain({ timeoutMs: 20_000 });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setupBackgroundSync() {
  // Run due jobs as soon as the user returns to the app.
  flushOnForeground(queue, AppState);
  // The OS decides when to run it; 15 minutes is the minimum it will honor.
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
}
