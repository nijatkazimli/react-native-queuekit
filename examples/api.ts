import { NonRetryableError, parseRetryAfter, RetryAfterError } from "@nijatk/react-native-queuekit";

const API = "https://api.example.com";

export async function send(
  path: string,
  init: { body: BodyInit; headers?: Record<string, string> },
  signal: AbortSignal,
  jobId: string,
) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    signal,
    ...init,
    // Jobs can run twice after a crash; the server dedupes on this key.
    headers: { "Idempotency-Key": jobId, ...init.headers },
  });
  if (res.ok) return;

  // Wait as long as the server asks instead of using the default backoff.
  const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
  if (retryAfter !== undefined) throw new RetryAfterError(retryAfter, `HTTP ${res.status}`);

  const clientError = res.status >= 400 && res.status < 500;
  const transient = res.status === 408 || res.status === 429;
  // Retrying a rejected request can never succeed, so stop right away.
  if (clientError && !transient) throw new NonRetryableError(`HTTP ${res.status}`);
  throw new Error(`HTTP ${res.status}`);
}

export const json = (body: unknown) => ({
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});
