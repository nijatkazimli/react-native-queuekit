/**
 * Synchronous string key/value store that jobs are persisted in. Synchronous
 * writes are what let `enqueue()` guarantee a job is saved before it returns.
 *
 * A `react-native-mmkv` instance (`createMMKV()`) satisfies this interface as-is.
 *
 * @example
 * createQueue({ storage: createMMKV({ id: 'queuekit' }) });
 */
export interface QueueStorage {
  /** Value for `key`, or `undefined` if absent. */
  getString(key: string): string | undefined;
  /** Write `value` under `key`, replacing any existing value. */
  set(key: string, value: string): void;
  /** Delete `key`. The return value is ignored. */
  remove(key: string): unknown;
  /** Every key in the store, including ones QueueKit did not write. */
  getAllKeys(): string[];
}

/**
 * In-memory `QueueStorage`. Nothing survives a restart, so use it for tests and
 * previews only.
 */
export function memoryStorage(): QueueStorage {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => map.delete(key),
    getAllKeys: () => [...map.keys()],
  };
}
