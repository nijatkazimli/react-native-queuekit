import { useSyncExternalStore } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
}

let current: ToastMessage | undefined;
let counter = 0;
const watchers = new Set<() => void>();

export function notify(text: string, kind: ToastMessage["kind"] = "info") {
  const id = ++counter;
  current = { id, text, kind };
  for (const watcher of watchers) watcher();
  setTimeout(() => {
    if (current?.id !== id) return;
    current = undefined;
    for (const watcher of watchers) watcher();
  }, 3500);
}

export const useToast = () =>
  useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
    () => current,
  );

/** Runs `action`, showing any thrown error as a toast. */
export function attempt<T>(action: () => T, success?: string): T | undefined {
  try {
    const result = action();
    if (success) notify(success, "ok");
    return result;
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  }
}

export async function attemptAsync<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  }
}
