import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { Job, JobFilter, Queue, QueueStats } from "../types.js";

const QueueContext = createContext<Queue | null>(null);

/**
 * Makes a queue available to the hooks below. Does not start or stop the queue.
 *
 * @example
 * <QueueProvider queue={queue}><App /></QueueProvider>
 */
export function QueueProvider({
  queue,
  children,
}: Readonly<{
  queue: Queue;
  children: ReactNode;
}>) {
  return <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>;
}

/**
 * The queue from the nearest `QueueProvider`.
 *
 * @throws If used outside a `QueueProvider`.
 */
export function useQueue(): Queue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useQueue must be used inside <QueueProvider>");
  return queue;
}

/**
 * Live list of jobs, oldest first, re-rendering only when jobs change. Includes
 * jobs saved in earlier sessions.
 *
 * @param filter - Optional `status` and/or `type` to match.
 */
export function useJobs(filter?: JobFilter): Job[] {
  const queue = useQueue();
  const all = useSyncExternalStore(queue.subscribe, () => queue.getJobs());
  const status = filter?.status;
  const type = filter?.type;
  return useMemo(() => {
    if (!status && !type) return all;
    return all.filter((job) => (!status || job.status === status) && (!type || job.type === type));
  }, [all, status, type]);
}

/** Live view of one job, or `undefined` once it completes or is removed. */
export function useJob(id: string): Job | undefined {
  return useJobs().find((job) => job.id === id);
}

/** Live job counts by status. Re-renders only when the counts object changes. */
export function useQueueStats(): QueueStats {
  const queue = useQueue();
  return useSyncExternalStore(queue.subscribe, queue.getStats);
}
