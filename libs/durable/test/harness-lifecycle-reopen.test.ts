import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessLifecycleSupport from "./harness-lifecycle-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { oneStep, start } = harnessLifecycleSupport;
const { makeTempFile, removeDir } = platformSupport;
const { context } = sessionSupport;
const { deferred, eventually, openTasks, settled } = taskSupport;

const letsNewHarness = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { directory, path } = yield* makeTempFile("msa-durable-lifecycle-", "session.sqlite");
  yield* Effect.gen(function* () {
    const log: string[] = [];
    const gate = deferred();
    let generation = 1;
    const Stubborn = oneStep("test.generations", () =>
      runPromise(
        Effect.gen(function* () {
          const mine = generation;
          log.push(`start ${mine}`);
          if (mine === 1) yield* awaited(gate.promise);
          log.push(`end ${mine}`);
        }),
      ),
    );
    const first = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Stubborn]);
    const id = yield* awaited(start(yield* awaited(first.harness.root(context)), Stubborn));
    first.harness.resume();
    yield* eventually(() => log.length === 1);
    const closing = first.harness.close(context).then(() => void log.push("closed"));
    expect(yield* settled(closing)).toBe(false);
    gate.resolve();
    yield* awaited(closing);
    expect(log).toEqual(["start 1", "end 1", "closed"]);
    generation = 2;
    const second = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Stubborn]);
    second.harness.resume();
    yield* awaited(second.harness.waitForTask(id, context));
    expect(log).toEqual(["start 1", "end 1", "closed", "start 2", "end 2"]);
    yield* awaited(second.harness.close(context));
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => removeDir(directory)))));
});

describe("Harness close", () => {
  it("lets a new Harness open the same Storage once close resolved: no old invocation code runs", () =>
    Effect.runPromise(letsNewHarness));
});
