import analytics from "@react-native-firebase/analytics";
import crashlytics from "@react-native-firebase/crashlytics";
import { appInsights } from "./appInsights"; // your ApplicationInsights instance
import { queue } from "./queue";

// Firebase Analytics + Crashlytics. Event names allow letters, digits and underscores only.
export function observeWithFirebase() {
  return queue.observe(({ event, job, error, durationMs }) => {
    void analytics().logEvent(`queue_${event}`, {
      type: job.type,
      attempts: job.attempts,
      duration_ms: durationMs ?? 0,
    });
    if (event === "failed") crashlytics().recordError(error as Error);
  });
}

// Azure Application Insights.
export function observeWithAppInsights() {
  return queue.observe(({ event, job, error, durationMs }) => {
    appInsights.trackEvent({
      name: `Queue.${event}`,
      properties: { type: job.type, jobId: job.id },
      measurements: { attempts: job.attempts, durationMs: durationMs ?? 0 },
    });
    if (event === "failed") {
      appInsights.trackException({ exception: error as Error, properties: { type: job.type } });
    }
  });
}
