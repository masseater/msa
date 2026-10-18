import { type ToolResultMessage } from "@msa/ai";
import { defineTool, LiveDoc, ToolResultEntry } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toolCalls, blockingTool } from "./harness-structured-events.ts";
import { gates, behaviors, log, directories } from "./harness-structured-support.ts";
import {
  allEntries,
  chatSetup,
  openChat,
  awaited,
  addTool,
  removeDir,
  context,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const abortsParallelRound = Effect.gen(function* () {
  const setup = chatSetup();
  const one = blockingTool("one");
  const two = blockingTool("two");
  addTool(setup.registry, defineTool({ ...one.registration, executionMode: "parallel" }));
  addTool(setup.registry, defineTool({ ...two.registration, executionMode: "parallel" }));
  setup.faux.setResponses([toolCalls(["one", "c1"], ["two", "c2"])]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(Promise.all([one.started, two.started]));
  const generation = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId;
  yield* awaited(harness.abortTask(generation, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  const results = (yield* allEntries(root)).filter((entry) => ToolResultEntry.is(entry));
  expect(results.map((entry) => (entry.model![0] as ToolResultMessage).toolCallId)).toEqual([
    "c1",
    "c2",
  ]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  expect((yield* awaited(harness.waitForTask(generation, context))).state.outcome.status).toBe(
    "aborted",
  );
  yield* awaited(harness.close(context));
});

describe("tool rounds", () => {
  it("aborts a parallel round with its generation: tools first, then the generation, with every result written", () =>
    Effect.runPromise(abortsParallelRound));
});
