// Illustrates the pattern with react-native-background-upload; adapt the calls to your uploader.
import Upload from "react-native-background-upload";
import { queue } from "../queue";

const API = "https://api.example.com";

function watch(jobId: string, uploadId: string) {
  Upload.addListener("completed", uploadId, (data) =>
    data.responseCode < 400
      ? queue.complete(jobId)
      : queue.fail(jobId, new Error(`HTTP ${data.responseCode}`)),
  );
  Upload.addListener("error", uploadId, (data) => queue.fail(jobId, new Error(data.error)));
  Upload.addListener("cancelled", uploadId, () => queue.remove(jobId));
}

export const uploadVideo = queue.define("uploadVideo", async ({ path }: { path: string }, ctx) => {
  const uploadId = await Upload.startUpload({
    url: `${API}/videos`,
    path,
    method: "POST",
    type: "multipart",
    field: "file",
    headers: { "Idempotency-Key": ctx.job.id },
  });
  watch(ctx.job.id, uploadId);
  // The OS keeps uploading if the app is suspended; the job stays active until complete()/fail().
  return ctx.detach(uploadId);
});

// Call once at startup to reattach to uploads that were running when the app last closed.
export function reattachUploads() {
  for (const job of queue.getJobs({ type: uploadVideo.type, status: "active" })) {
    if (job.externalId) watch(job.id, job.externalId);
  }
}
