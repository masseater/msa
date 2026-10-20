import { type Usage } from "@msa/ai";
import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessNestedToolsSupport from "./harness-nested-tools-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;
const { LiveDoc } = durable;
const { ToolTask } = harnessModule;

const { DONE, call, echoTool, runOnce, tool, toolTasks } = harnessNestedToolsSupport;
const { addTool, awaited, chatSetup, context, deferred, openChat } = support;

function summarizedTools() {
  const setup = chatSetup();
  const release = deferred();
  const checked = deferred();
  addTool(
    setup.registry,
    tool("verbose", () =>
      Promise.resolve({
        diagnostics: [{ message: "e".repeat(600), severity: "error" }],
        isError: true,
        output: [{ text: "ignored", type: "text" }],
      }),
    ),
  );
  const usage: Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0.1, output: 0.2, total: 0.3 },
    input: 1,
    output: 2,
    totalTokens: 3,
  };
  return { checked, release, setup, usage };
}

function summarizedBatch() {
  const { setup, release, checked, usage } = summarizedTools();
  addTool(setup.registry, echoTool().registration);
  addTool(
    setup.registry,
    tool("paid", () => Promise.resolve({ usage })),
  );
  addTool(
    setup.registry,
    tool("broken", () =>
      Promise.resolve({
        isError: true,
        output: [
          { text: "bad image", type: "text" },
          { data: "AAAA", mimeType: "image/png", type: "image" },
        ],
      }),
    ),
  );
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* awaited(api.executeTool("echo", { text: "a" }, callContext));
          yield* awaited(api.executeTool("missing", {}, callContext));
          yield* awaited(api.executeTool("paid", {}, callContext));
          yield* awaited(api.executeTool("broken", {}, callContext));
          yield* awaited(api.executeTool("verbose", {}, callContext));
          checked.resolve();
          yield* awaited(release.promise);
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  return { checked, release, setup, usage };
}

const givesCallersResult = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", () =>
      Promise.resolve({ details: { count: 1n } as unknown as chordTypes.JsonValue }),
    ),
  );
  let result: durableTypes.NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          result = yield* awaited(api.executeTool("echo", { text: "a" }, callContext));
          return {};
        }),
      ),
    ),
  );
  setup.faux.setResponses([call("batch"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const [, child] = yield* toolTasks(harness);
  expect(child!.state).toMatchObject({ outcome: { status: "faulted" }, status: "terminal" });
  expect(result).toEqual({
    diagnostics: [
      {
        code: "faulted",
        message: expect.stringContaining("Tool echo failed"),
        severity: "error",
      },
    ],
    isError: true,
    taskId: child!.id,
  });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("gives callers a result with its task ID and only diagnostics for a nested call the scheduler faulted", () =>
    Effect.runPromise(givesCallersResult));
});

const givesCallersWhat = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("fails", (_args, api) => {
      api.output("half way\n");
      return Promise.reject(new Error("broke"));
    }),
  );
  let result: durableTypes.NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    tool("batch", (_args, api, callContext) =>
      runPromise(
        Effect.gen(function* () {
          result = yield* awaited(api.executeTool("fails", {}, callContext));
          return {};
        }),
      ),
    ),
  );
  const { harness } = yield* runOnce(setup, [call("batch"), DONE]);
  expect(result).toMatchObject({
    diagnostics: [{ code: "tool_error", message: "broke" }],
    isError: true,
    structuredOutput: "half way\n",
  });
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("gives callers what a schema-less tool streamed before it threw", () =>
    Effect.runPromise(givesCallersWhat));
});

const showsFinishedNested = Effect.gen(function* () {
  const { setup, release, checked, usage } = summarizedBatch();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "go", type: "input" }, context));
  yield* awaited(checked.promise);
  const slots = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.nestedTools!;
  expect(slots.map(({ callId, status, summary }) => ({ callId, status, summary }))).toEqual([
    {
      callId: "c1/1",
      status: "done",
      summary: { durationMs: expect.any(Number), isError: false },
    },
    {
      callId: "c1/2",
      status: "done",
      summary: { error: "Tool missing is not available", isError: true },
    },
    {
      callId: "c1/3",
      status: "done",
      summary: { durationMs: expect.any(Number), isError: false, usage },
    },
    {
      callId: "c1/4",
      status: "done",
      summary: { durationMs: expect.any(Number), error: "bad image", isError: true },
    },
    {
      callId: "c1/5",
      status: "done",
      summary: { durationMs: expect.any(Number), error: "e".repeat(500), isError: true },
    },
  ]);
  release.resolve();
  yield* awaited(submission.wait(context));
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("nested tool calls", () => {
  it("shows a finished nested call as a done slot with its summary until its caller settles", () =>
    Effect.runPromise(showsFinishedNested));

  it("migrates version 1 tool task input to a model-issued call", () => {
    const migrate = ToolTask.definition.migrate!;
    expect(migrate({ assistant: 3, callId: "c1" }, { phase: "call" }, 1)).toEqual({
      checkpoint: { phase: "call" },
      input: { assistant: 3, callId: "c1", kind: "model" },
    });
  });
});
