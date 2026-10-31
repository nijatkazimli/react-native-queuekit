import type { Queue } from "../types.js";

/** The part of React Native's `AppState` that `flushOnForeground` needs. */
interface AppStateLike {
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

/**
 * Calls `queue.flush()` whenever the app returns to the foreground, so jobs that
 * came due while it was suspended run right away.
 *
 * @param appState - React Native's `AppState`.
 * @returns A function that stops listening.
 * @example
 * import { AppState } from 'react-native';
 * flushOnForeground(queue, AppState);
 */
export function flushOnForeground(queue: Pick<Queue, "flush">, appState: AppStateLike): () => void {
  const subscription = appState.addEventListener("change", (state) => {
    if (state === "active") queue.flush();
  });
  return () => subscription.remove();
}
