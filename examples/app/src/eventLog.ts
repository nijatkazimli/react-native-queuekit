import type { Queue, QueueEvent, QueueEventInfo } from "@nijatk/react-native-queuekit";
import { useSyncExternalStore } from "react";

export interface LogEntry {
  id: number;
  at: number;
  instance: string;
  event: QueueEvent;
  type: string;
  jobId: string;
  attempt: number;
  payload: unknown;
  sensitive: boolean;
  error?: string;
  durationMs?: number;
  result?: unknown;
}

const MAX_ENTRIES = 300;
let entries: LogEntry[] = [];
let nextId = 1;
const watchers = new Set<() => void>();

const push = (instance: string, info: QueueEventInfo) => {
  const { job, error, durationMs, result } = info;
  const entry: LogEntry = {
    id: nextId++,
    at: Date.now(),
    instance,
    event: info.event,
    type: job.type,
    jobId: job.id,
    attempt: job.attempts,
    payload: job.payload,
    sensitive: job.sensitive === true,
    error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
    durationMs,
    result,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  for (const watcher of watchers) watcher();
};

/** Records every event of `queue`; returns the unsubscribe function. */
export const attachLog = (queue: Queue, instance: string) =>
  queue.observe((info) => push(instance, info));

export const clearLog = () => {
  entries = [];
  for (const watcher of watchers) watcher();
};

export const useLog = () =>
  useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    () => entries,
  );
