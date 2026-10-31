import { queue } from "./queue";

// Lifecycle events are the hook for logging, analytics and crash reporting.
queue.on("retry", (job, error) => {
  console.log(`[queue] ${job.type} retry ${job.attempts}/${job.maxAttempts}`, error);
});

queue.on("failed", (job, error) => {
  // Replace with Sentry.captureException, Crashlytics, etc.
  console.warn(`[queue] ${job.type} gave up after ${job.attempts} attempts`, error);
});
