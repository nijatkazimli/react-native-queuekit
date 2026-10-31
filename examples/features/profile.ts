import type { JobContext } from "@nijatk/react-native-queuekit";
import { json, send } from "../api";
import { queue } from "../queue";

export type ProfilePatch = { displayName?: string; bio?: string };

class ProfileService {
  // Registered when the class is instantiated, bound to `this`.
  @queue.handler("updateProfile", { priority: 5 })
  async update(patch: ProfilePatch, { job, signal }: JobContext) {
    await send("/profile", json(patch), signal, job.id);
  }
}

// One instance per class: it owns the handler.
export const profile = new ProfileService();

// Anywhere: queue.enqueue(profile.update, { displayName: "Ada" });
