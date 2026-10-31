import { json, send } from "../api";
import { queue } from "../queue";

// Fire-and-forget: never blocks the UI, survives offline sessions.
export const track = queue.define(
  "trackEvent",
  (payload: { name: string; props?: Record<string, string> }, { job, signal }) =>
    send("/events", json(payload), signal, job.id),
  { priority: -1, maxAttempts: 10 },
);
