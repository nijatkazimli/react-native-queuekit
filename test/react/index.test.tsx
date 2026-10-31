// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobFilter } from "../../src/index.js";
import { createQueue, memoryStorage } from "../../src/index.js";
import { QueueProvider, useJob, useJobs, useQueue, useQueueStats } from "../../src/react/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

function render(ui: ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(ui));
  mounted.push(() => act(() => root.unmount()));
  return container;
}

function Probe({ filter, id = "" }: Readonly<{ filter?: JobFilter; id?: string }>) {
  const jobs = useJobs(filter);
  const job = useJob(id);
  const stats = useQueueStats();
  return <p>{JSON.stringify({ types: jobs.map((j) => j.type), job: job?.type ?? null, stats })}</p>;
}

const read = (container: HTMLElement) => JSON.parse(container.textContent!);

let seen: unknown;
function Grab() {
  seen = useQueue();
  return null;
}

describe("react bindings", () => {
  it("useJobs, useJob and useQueueStats follow the queue live", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const a = queue.enqueue("a", 1);
    const container = render(
      <QueueProvider queue={queue}>
        <Probe id={a.id} />
      </QueueProvider>,
    );

    expect(read(container)).toMatchObject({
      types: ["a"],
      job: "a",
      stats: { pending: 1, total: 1 },
    });

    act(() => void queue.enqueue("b", 2));
    expect(read(container)).toMatchObject({ types: ["a", "b"], stats: { total: 2 } });

    act(() => void queue.remove(a.id));
    expect(read(container)).toMatchObject({ types: ["b"], job: null, stats: { total: 1 } });
  });

  it.each([
    [undefined, ["a", "b"]],
    [{}, ["a", "b"]],
    [{ status: "pending" as const }, ["a", "b"]],
    [{ status: "failed" as const }, []],
    [{ type: "a" }, ["a"]],
    [{ status: "pending" as const, type: "b" }, ["b"]],
  ])("useJobs filters by %o", (filter, expected) => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    queue.enqueue("a", 1);
    queue.enqueue("b", 2);

    const container = render(
      <QueueProvider queue={queue}>
        <Probe filter={filter} />
      </QueueProvider>,
    );

    expect(read(container).types).toEqual(expected);
  });

  it("useQueue returns the provided queue and throws outside a provider", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });

    render(
      <QueueProvider queue={queue}>
        <Grab />
      </QueueProvider>,
    );
    expect(seen).toBe(queue);

    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Grab />)).toThrow(/QueueProvider/);
    silence.mockRestore();
  });
});
