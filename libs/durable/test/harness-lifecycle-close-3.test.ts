import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { start, oneStep } from "./harness-lifecycle-support.ts";
import { addTask } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

const runsWhatRegistry = Effect.gen(function* () {
  const log: string[] = [];
  const define = (label: string) =>
    oneStep("test.late-definition", () => {
      log.push(label);

      return Promise.resolve();
    });
  const storage = new MemoryStorage();
  const first = yield* openTasks(storage, []);
  const root = yield* awaited(first.harness.root(context));
  const missing = yield* awaited(start(root, define("unused")));
  expect((yield* awaited(first.harness.inspect(context))).tasks).toMatchObject([
    { state: { kind: "blocked", reason: "missing_task" } },
  ]);
  const installed = addTask(first.registry, define("v1"));
  expect((yield* awaited(first.harness.inspect(context))).tasks).toMatchObject([
    { state: { kind: "ready" } },
  ]);
  installed.dispose();
  addTask(first.registry, define("v2"));
  first.harness.resume();
  yield* awaited(first.harness.waitForTask(missing, context));
  expect(log).toEqual(["v2"]);
  yield* awaited(first.harness.close(context));
});

describe("registry changes before resume", () => {
  it("runs what the registry holds at resume: a definition installed or replaced after open", () =>
    Effect.runPromise(runsWhatRegistry));
});
