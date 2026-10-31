import type { QueueStorage } from "../platform/storage.js";

export interface Lease {
  /** Take or renew the lease. Returns true if this owner holds it afterwards. */
  acquire(): boolean;
  /** Give the lease up, but only if this owner still holds it. */
  release(): void;
}

type LeaseRecord = { owner: string; until: number };

/**
 * A time-limited claim on a storage key. It keeps several queue instances that share
 * one storage from running jobs at the same time. Storage has no compare-and-set, so
 * two instances acquiring in the same instant can both believe they won; the claim is
 * re-read after writing to narrow that window.
 */
export function createLease(storage: QueueStorage, key: string, ttlMs: number): Lease {
  const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  function read(): LeaseRecord | null {
    try {
      return JSON.parse(storage.getString(key) ?? "null") as LeaseRecord | null;
    } catch {
      return null;
    }
  }

  return {
    acquire() {
      const now = Date.now();
      const current = read();
      if (current && current.owner !== owner && current.until > now) return false;
      storage.set(key, JSON.stringify({ owner, until: now + ttlMs }));
      return read()?.owner === owner;
    },
    release() {
      if (read()?.owner === owner) storage.remove(key);
    },
  };
}
