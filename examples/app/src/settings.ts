import { readSetting, type StorageKind, writeSetting } from "./storage";

export interface Settings {
  storage: StorageKind;
  concurrency: number;
  timeoutMs: number;
  retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; jitter: boolean };
  limitedEnabled: boolean;
  limitedConcurrency: number;
  limitedRateMax: number;
  limitedRatePerMs: number;
  retentionEnabled: boolean;
  maxFailed: number;
  failedTtlMs: number;
  maxPayloadBytes: number;
  lease: boolean;
  strict: boolean;
}

// Shorter timings than the library defaults, so behavior is visible within seconds.
export const DEFAULT_SETTINGS: Settings = {
  storage: "mmkv",
  concurrency: 3,
  timeoutMs: 10_000,
  retry: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 8_000, jitter: false },
  limitedEnabled: true,
  limitedConcurrency: 1,
  limitedRateMax: 3,
  limitedRatePerMs: 6_000,
  retentionEnabled: false,
  maxFailed: 3,
  failedTtlMs: 60_000,
  maxPayloadBytes: 4_096,
  lease: false,
  strict: true,
};

const KEY = "settings";

export function loadSettings(): Settings {
  try {
    const raw = readSetting(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...saved, retry: { ...DEFAULT_SETTINGS.retry, ...saved.retry } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const saveSettings = (settings: Settings) => writeSetting(KEY, JSON.stringify(settings));
