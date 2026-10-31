/**
 * Returned by `ctx.detach()`. Tells the queue the work continues outside the
 * JS runtime (for example an OS background upload), so the job stays `active`
 * and holds no concurrency slot until `queue.complete()` or `queue.fail()`.
 */
export class Detached {
  /** @param externalId - Id of the external task, e.g. the native upload id. Stored on the job. */
  constructor(readonly externalId: string) {}
}
