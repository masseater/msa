import type { Context } from "@msa/chord";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { started } from "./harness-storage-failure-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

describe("a failed Storage call", () => {
  it("closes the backend only after a paged read underway, which cannot start another page", async () => {
    const pages: string[] = [];
    const firstPage = deferred();
    const releaseFirst = deferred();
    class Paged extends ControlledStorage {
      override async scanEntries(...args: Parameters<MemoryStorage["scanEntries"]>) {
        if (args[1] > 1) {
          pages.push(args[2] === undefined ? "first" : "next");
          if (args[2] === undefined) {
            firstPage.resolve();
            await releaseFirst.promise;
          }
        }
        return super.scanEntries(...args);
      }
      override close(closeContext: Context): Promise<void> {
        pages.push("close");
        return Promise.resolve(super.close(closeContext));
      }
    }
    const storage = new Paged();
    const { harness, root } = await started(storage);
    // More entries than one page of the context read.
    await root.commit(async (tx) => {
      for await (const _ of Array.from({ length: 300 }))
        await tx.appendEntry(root.id, { kind: "note" });
    }, context);
    const reading = root.context(context);
    await firstPage.promise;
    const closing = harness.close(context);
    releaseFirst.resolve();
    await expect(reading).rejects.toThrow("is closed");
    await closing;
    expect(pages).toEqual(["first", "close"]);
    expect(await harness.closed).toEqual({ reason: "closed" });
  });
});
