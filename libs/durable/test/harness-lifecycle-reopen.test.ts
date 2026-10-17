import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { start, oneStep } from "./harness-lifecycle-support.ts";
import { context } from "./session-support.ts";
import { deferred, eventually, openTasks, settled } from "./task-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

describe("Harness close", () => {
  it("lets a new Harness open the same Storage once close resolved: no old invocation code runs", async () => {
    const { directory, path } = await makeTempFile("msa-durable-lifecycle-", "session.sqlite");
    try {
      const log: string[] = [];
      const gate = deferred();
      let generation = 1;
      const Stubborn = oneStep("test.generations", async () => {
        const mine = generation;
        log.push(`start ${mine}`);
        if (mine === 1) await gate.promise;
        log.push(`end ${mine}`);
      });
      const first = await openTasks(await openNodeSqliteStorage(path), [Stubborn]);
      const id = await start(await first.harness.root(context), Stubborn);
      first.harness.resume();
      await eventually(() => log.length === 1);
      const closing = first.harness.close(context).then(() => void log.push("closed"));
      expect(await settled(closing)).toBe(false);
      gate.resolve();
      await closing;
      expect(log).toEqual(["start 1", "end 1", "closed"]);
      generation = 2;
      const second = await openTasks(await openNodeSqliteStorage(path), [Stubborn]);
      second.harness.resume();
      await second.harness.waitForTask(id, context);
      expect(log).toEqual(["start 1", "end 1", "closed", "start 2", "end 2"]);
      await second.harness.close(context);
    } finally {
      await removeDir(directory);
    }
  });
});
