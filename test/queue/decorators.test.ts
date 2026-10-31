import { describe, expect, it } from "vitest";
import type { JobContext } from "../../src/index.js";
import { createQueue, memoryStorage } from "../../src/index.js";

// Uses the real decorator syntax, lowered by TypeScript (see vitest.config.ts).
describe("@queue.handler with real decorator syntax", () => {
  it("registers instance methods per instance and static methods at class definition", async () => {
    const queue = createQueue({ storage: memoryStorage() });
    const seen: string[] = [];

    class Service {
      constructor(readonly name: string) {}

      @queue.handler("instance", { priority: 4 })
      async run(payload: string, _ctx?: JobContext) {
        seen.push(`${this.name}:${payload}`);
      }

      @queue.handler("static")
      static async go(payload: string) {
        // biome-ignore lint/complexity/noThisInStatic: the test checks that `this` is the class
        seen.push(`${this.name}:${payload}`);
      }
    }
    const service = new Service("svc");

    expect(queue.enqueue(service.run, "a")).toMatchObject({ type: "instance", priority: 4 });
    queue.enqueue(Service.go, "b");
    await queue.drain();

    expect(seen.sort()).toEqual(["Service:b", "svc:a"]);
  });

  it("strict mode rejects a second instance of the same class", () => {
    const queue = createQueue({ storage: memoryStorage(), strict: true });

    class Service {
      @queue.handler("only")
      async run(_payload: string) {}
    }

    expect(() => new Service()).not.toThrow();
    expect(() => new Service()).toThrow(/already defined/);
  });
});
