import { type AgentEvent, LiveDoc } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { DONE, call, directories, text, tool, toolTasks } = harnessNestedToolsSupport;
const { addTool, awaited, chatSetup, context, deferred, openChat, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function slowNestedBatch() {
  const setup = chatSetup();
  const release = deferred();
  const running = deferred();
  addTool(
    setup.registry,
    tool("slow", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          api.output("working\n");
          yield* awaited(api.details({ step: 1 }, callContext));
          running.resolve();
          yield* awaited(release.promise);
          return { output: [{ text: "slow done", type: "text" }] };
        }),
      ),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* awaited(api.executeTool("slow", {}, callContext));
          return { output: [{ text: text(result), type: "text" }] };
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { release, running, setup };
}

const openSlowNestedBatch = Effect.fn("openSlowNestedBatch")(function* () {
  const { setup, release, running } = slowNestedBatch();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  expect(stream.snapshot.nestedTools).toEqual([]);
  const events: AgentEvent[] = [];
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  return { events, harness, release, root, running, stream };
});

const slowNestedCallRunning = Effect.fn("slowNestedCallRunning")(function* () {
  const { release, running, harness, root, stream, events } = yield* openSlowNestedBatch();
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(running.promise);
  const live = yield* awaited(harness.snapshot(LiveDoc, root.id, context));
  expect(live?.nestedTools).toEqual([
    {
      arguments: {},
      callId: "c1/1",
      details: { step: 1 },
      name: "slow",
      output: "working\n",
      parentCallId: "c1",
      parentTaskId: expect.any(Number),
      status: "running",
      taskId: expect.any(Number),
    },
  ]);
  return { events, harness, release, root, stream, submission };
});

const reportsNestedCalls = Effect.gen(function* () {
  const { release, harness, root, stream, events, submission } = yield* slowNestedCallRunning();
  release.resolve();
  yield* awaited(submission.wait(context));
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(stream.stop());
  const tools = events.flatMap((event) =>
    event.type === "tool_execution_start" || event.type === "tool_execution_end"
      ? [[event.type, event.toolCallId, event.parentToolCallId]]
      : [],
  );
  expect(tools).toEqual([
    ["tool_execution_start", "c1", undefined],
    ["tool_execution_start", "c1/1", "c1"],
    ["tool_execution_end", "c1/1", "c1"],
    ["tool_execution_end", "c1", undefined],
  ]);
  const nestedEnd = events.find(
    (event) => event.type === "tool_execution_end" && event.toolCallId === "c1/1",
  );
  expect(nestedEnd).toMatchObject({
    result: { isError: false, structuredOutput: "slow done" },
  });
  const [parent, child] = yield* toolTasks(harness);
  const parentEnd = events.find(
    (event) => event.type === "tool_execution_end" && event.toolCallId === "c1",
  );
  expect(nestedEnd).toMatchObject({ parentTaskId: parent!.id, taskId: child!.id });
  expect(parentEnd).toMatchObject({ taskId: parent!.id });
  expect(parentEnd).not.toHaveProperty("parentTaskId");
  expect(
    events.some(
      (event) =>
        event.type === "tool_execution_update" &&
        event.toolCallId === "c1/1" &&
        event.parentToolCallId === "c1",
    ),
  ).toBe(true);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("reports nested calls in msa.live.nestedTools and as tool events with their parent", () =>
    Effect.runPromise(reportsNestedCalls));
});
