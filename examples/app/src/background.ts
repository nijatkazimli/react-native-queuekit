import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { getRuntime } from "./runtime";

export const BACKGROUND_TASK = "queuekit-lab-drain";
export const backgroundSupported = Platform.OS !== "web";

// Must be defined at module scope so the OS can start it without any UI.
if (backgroundSupported) {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    try {
      // The OS allows roughly 30 seconds; stop waiting a little before that.
      await getRuntime().queue.drain({ timeoutMs: 20_000 });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export const registerBackground = () =>
  BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });

export const unregisterBackground = () => BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);

export const backgroundStatus = () => BackgroundTask.getStatusAsync();

/** Development only: runs the task now instead of waiting for the OS. */
export const triggerBackground = () => BackgroundTask.triggerTaskWorkerForTestingAsync();
