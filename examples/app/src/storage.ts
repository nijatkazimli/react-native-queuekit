import type { QueueStorage } from "@nijatk/react-native-queuekit";
import { memoryStorage } from "@nijatk/react-native-queuekit";
import { createMMKV } from "react-native-mmkv";

export type StorageKind = "mmkv" | "memory";

export interface AppStorage extends QueueStorage {
  clearAll(): void;
}

// One instance per kind for the whole process, so a rebuilt queue reads what the old one wrote.
const mmkv = createMMKV({ id: "queuekit-lab" });
const memory = memoryStorage();

const instances: Record<StorageKind, AppStorage> = {
  mmkv,
  memory: {
    ...memory,
    clearAll: () => {
      for (const key of memory.getAllKeys()) memory.remove(key);
    },
  },
};

export const getStorage = (kind: StorageKind): AppStorage => instances[kind];

// App preferences live in their own MMKV instance so wiping queue data keeps them.
const settingsStore = createMMKV({ id: "queuekit-lab-settings" });
export const readSetting = (key: string) => settingsStore.getString(key);
export const writeSetting = (key: string, value: string) => settingsStore.set(key, value);
