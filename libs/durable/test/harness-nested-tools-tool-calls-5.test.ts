import { type Usage } from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import { LiveDoc, type NestedToolExecutionResult } from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { toolTasks, runOnce, DONE, call, tool, echoTool } from "./harness-nested-tools-support.ts";
import { chatSetup, openChat, awaited, addTool, context, deferred } from "./support.ts";

function summarizedTools() {
  const setup = chatSetup();
  const release = deferred();
  const checked = deferred();
  addTool(
    setup.registry,
    tool("verbose", () =>
      Promise.resolve({
        output: [{ type: "text", text: "ignored" }],
        isError: true,
        diagnostics: [{ severity: "error", message: "e".repeat(600) }],
      }),
    ),
  );
  const usage: Usage = {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  };
  return { setup, release, checked, usage };
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
        output: [
          { type: "text", text: "bad image" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
        isError: true,
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
  return { setup, release, checked, usage };
}

const givesCallersResult = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  addTool(
    setup.registry,
    tool("echo", () => Promise.resolve({ details: { count: 1n } as unknown as JsonValue })),
  );
  let result: NestedToolExecutionResult | undefined;
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
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const [, child] = yield* toolTasks(harness);
  expect(child!.state).toMatchObject({ status: "terminal", outcome: { status: "faulted" } });
  expect(result).toEqual({
    taskId: child!.id,
    isError: true,
    diagnostics: [
      {
        severity: "error",
        code: "faulted",
        message: expect.stringContaining("Tool echo failed"),
      },
    ],
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
  let result: NestedToolExecutionResult | undefined;
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
    isError: true,
    structuredOutput: "half way\n",
    diagnostics: [{ code: "tool_error", message: "broke" }],
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
  const submission = yield* awaited(root.submit({ type: "input", content: "go" }, context));
  yield* awaited(checked.promise);
  const slots = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.nestedTools!;
  expect(slots.map(({ callId, status, summary }) => ({ callId, status, summary }))).toEqual([
    {
      callId: "c1/1",
      status: "done",
      summary: { isError: false, durationMs: expect.any(Number) },
    },
    {
      callId: "c1/2",
      status: "done",
      summary: { isError: true, error: "Tool missing is not available" },
    },
    {
      callId: "c1/3",
      status: "done",
      summary: { isError: false, durationMs: expect.any(Number), usage },
    },
    {
      callId: "c1/4",
      status: "done",
      summary: { isError: true, durationMs: expect.any(Number), error: "bad image" },
    },
    {
      callId: "c1/5",
      status: "done",
      summary: { isError: true, durationMs: expect.any(Number), error: "e".repeat(500) },
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
      input: { kind: "model", assistant: 3, callId: "c1" },
      checkpoint: { phase: "call" },
    });
  });
});
