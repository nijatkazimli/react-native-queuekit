import type { Queue } from "@nijatk/react-native-queuekit";
import { createQueue } from "@nijatk/react-native-queuekit";
import { useSyncExternalStore } from "react";
import { attachLog } from "./eventLog";
import { defineJobs, type Jobs, MIGRATIONS } from "./jobs";
import { simulatedNetwork } from "./network";
import { loadSettings, type Settings, saveSettings } from "./settings";
import { type AppStorage, getStorage } from "./storage";

export const QUEUE_NAME = "lab";
const LEASE_TTL_MS = 3_000;

export interface Follower {
  label: string;
  queue: Queue;
  jobs: Jobs;
  stopLog: () => void;
}

export interface Runtime {
  /** Increments on every rebuild, so screens can tell a fresh queue from the old one. */
  generation: number;
  settings: Settings;
  storage: AppStorage;
  queue: Queue;
  jobs: Jobs;
  followers: Follower[];
  stopLog: () => void;
}

function makeQueue(settings: Settings, storage: AppStorage) {
  return createQueue({
    name: QUEUE_NAME,
    storage,
    network: simulatedNetwork,
    concurrency: settings.concurrency,
    timeoutMs: settings.timeoutMs,
    retry: settings.retry,
    limits: settings.limitedEnabled
      ? {
          "demo.limited": {
            concurrency: settings.limitedConcurrency,
            rate: { max: settings.limitedRateMax, perMs: settings.limitedRatePerMs },
          },
        }
      : undefined,
    migrations: MIGRATIONS,
    retention: settings.retentionEnabled
      ? {
          maxFailed: settings.maxFailed > 0 ? settings.maxFailed : undefined,
          failedTtlMs: settings.failedTtlMs > 0 ? settings.failedTtlMs : undefined,
        }
      : undefined,
    maxPayloadBytes: settings.maxPayloadBytes > 0 ? settings.maxPayloadBytes : Infinity,
    lease: settings.lease ? { ttlMs: LEASE_TTL_MS } : false,
    strict: settings.strict,
    // Started below, after the event log is attached, so events from loading saved jobs are kept.
    autoStart: false,
  });
}

let generation = 0;

function build(settings: Settings): Runtime {
  const storage = getStorage(settings.storage);
  const queue = makeQueue(settings, storage);
  const jobs = defineJobs(queue);
  const stopLog = attachLog(queue, "A");
  queue.start();
  return { generation: ++generation, settings, storage, queue, jobs, followers: [], stopLog };
}

function teardown(runtime: Runtime) {
  for (const follower of runtime.followers) {
    follower.stopLog();
    follower.queue.dispose();
  }
  runtime.stopLog();
  runtime.queue.dispose();
}

let current: Runtime | undefined;
const watchers = new Set<() => void>();
const publish = (next: Runtime) => {
  current = next;
  for (const watcher of watchers) watcher();
};

/** The shared runtime; the headless background task uses it too. */
export function getRuntime(): Runtime {
  current ??= build(loadSettings());
  return current;
}

/**
 * Disposes the queue and creates a fresh one from storage, like an app restart.
 * Pass new settings to change the configuration at the same time.
 */
export function rebuildRuntime(settings?: Settings) {
  const old = getRuntime();
  const next = settings ?? old.settings;
  if (settings) saveSettings(settings);
  teardown(old);
  publish(build(next));
}

/** A second queue on the same storage and name. With `lease` on, only one of the two runs jobs. */
export function spawnFollower() {
  const runtime = getRuntime();
  const label = String.fromCharCode(66 + runtime.followers.length); // B, C, ...
  const queue = makeQueue(runtime.settings, runtime.storage);
  const jobs = defineJobs(queue);
  const stopLog = attachLog(queue, label);
  queue.start();
  publish({ ...runtime, followers: [...runtime.followers, { label, queue, jobs, stopLog }] });
}

export function removeFollower(label: string) {
  const runtime = getRuntime();
  const gone = runtime.followers.find((f) => f.label === label);
  if (!gone) return;
  gone.stopLog();
  gone.queue.dispose();
  publish({ ...runtime, followers: runtime.followers.filter((f) => f !== gone) });
}

export const useRuntime = () =>
  useSyncExternalStore((watcher) => {
    watchers.add(watcher);
    return () => {
      watchers.delete(watcher);
    };
  }, getRuntime);
