import { send } from "../api";
import { queue } from "../queue";

export type PhotoUpload = { uri: string; albumId: string };

export const uploadPhoto = queue.define(
  "uploadPhoto",
  async ({ uri, albumId }: PhotoUpload, { job, signal }) => {
    const body = new FormData();
    body.append("albumId", albumId);
    // React Native's FormData accepts a { uri, name, type } file descriptor.
    body.append("file", { uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
    await send("/photos", { body }, signal, job.id);
  },
);
