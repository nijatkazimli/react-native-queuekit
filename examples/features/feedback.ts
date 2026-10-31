import { json, send } from "../api";
import { queue } from "../queue";

export const submitFeedback = queue.define(
  "submitFeedback",
  (payload: { rating: number; comment: string }, { job, signal }) =>
    send("/feedback", json(payload), signal, job.id),
  // High priority so it jumps ahead of background uploads.
  { priority: 10 },
);
