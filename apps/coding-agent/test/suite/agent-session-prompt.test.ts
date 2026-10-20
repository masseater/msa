import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionPromptSupport from "./agent-session-prompt-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { removePath, runTest } = testing;

const { harnesses, tempDirs } = agentSessionPromptSupport;

const { createHarness, getMessageText } = harnessModule;

const processImage = vi.hoisted(() =>
  vi.fn((_bytes: Uint8Array, mimeType: string) =>
    Promise.resolve({
      data: Buffer.from("normalized").toString("base64"),
      hints: [],
      mimeType,
      ok: true as const,
    }),
  ),
);

vi.mock("../../src/utils/image-process.ts", () => ({ default: { processImage } }));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const promptsWhileIdleAndRecordsA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("hello")]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
  ]);
  expect(getMessageText(harness.session.messages[1]!)).toBe("hi");
  expect(harness.getPendingResponseCount()).toBe(0);
});

const handlesAToolCallTurnAnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: agentTypes.AgentTool = {
    description: "Echo text back",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return {
            content: [{ text: `echo:${text}`, type: "text" }],
            details: { text },
          };
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(toolRuns).toEqual(["hello"]);
  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
  expect(harness.session.messages[3]?.role).toBe("toolResult");
  expect(harness.session.messages[4]?.role).toBe("assistant");
});

const executesMultipleToolCallsFromOne = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const makeTool = (name: string, delayMs: number): agentTypes.AgentTool => ({
    description: `${name} tool`,
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const value =
            typeof params === "object" && params !== null && "value" in params
              ? String(params.value)
              : "";
          yield* Effect.sleep(delayMs);
          toolRuns.push(`${name}:${value}`);
          return {
            content: [{ text: `${name}:${value}`, type: "text" }],
            details: { value },
          };
        }),
      ),
    label: name,
    name,
    parameters: Type.Object({ value: Type.String() }),
  });
  const harness = yield* Effect.promise(() =>
    createHarness({ tools: [makeTool("slow", 25), makeTool("fast", 0)] }),
  );
  harnesses.push(harness);
  return yield* executesMultipleToolCallsFromOneStep1(toolRuns, harness);
});

const executesMultipleToolCallsFromOneStep1 = (toolRuns: string[], harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("slow", { value: "a" }), fauxToolCall("fast", { value: "b" })],
        {
          stopReason: "toolUse",
        },
      ),
      (context) => {
        const toolResults = context.messages.filter((message) => message.role === "toolResult");
        return fauxAssistantMessage(`tool results: ${toolResults.length}`);
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("run tools"));
    expect(toolRuns.sort()).toEqual(["fast:b", "slow:a"]);
    expect(
      harness.session.messages.filter((message) => message.role === "toolResult"),
    ).toHaveLength(2);
    expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("assistant");
  });

const preservesImageAttachmentsInTheProvider = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  let sawImage = false;

  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      sawImage =
        user?.role === "user" &&
        typeof user.content !== "string" &&
        user.content.some((part) => part.type === "image");
      return fauxAssistantMessage("ok");
    },
  ]);

  yield* Effect.promise(() =>
    harness.session.prompt("describe", {
      images: [
        {
          data: "ZmFrZQ==",
          mimeType: "image/png",
          type: "image",
        },
      ],
    }),
  );

  expect(sawImage).toBe(true);
});

const usesTheModelSelectedByBefore = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let strictModel: aiTypes.Model<string> | undefined;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () =>
            runPromise(
              Effect.gen(function* () {
                const model = strictModel;
                if (model === undefined) throw new Error("Expected strict model");
                yield* Effect.promise(() => msa.setModel(model));
              }),
            ),
          );
        },
      ],
      models: [{ id: "wide" }, { id: "strict" }],
    }),
  );
  harnesses.push(harness);
  strictModel = harness.getModel("strict");
  if (strictModel === undefined) throw new Error("Expected strict model");
  return yield* usesTheModelSelectedByBeforeStep1(strictModel, harness);
});

const usesTheModelSelectedByBeforeStep1 = (
  strictModel: aiTypes.Model<string> | undefined,
  harness: harnessTypes.Harness,
) =>
  Effect.gen(function* () {
    const resizeOptions = {
      jpegQuality: 70,
      maxBytes: 500000,
      maxHeight: 1000,
      maxWidth: 1000,
    };
    if (strictModel === undefined) throw new Error("Expected strict model");
    strictModel.inputLimits = { images: { resize: resizeOptions } };
    harness.setResponses([fauxAssistantMessage("done")]);
    yield* Effect.promise(() =>
      harness.session.prompt("inspect", {
        images: [{ data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" }],
      }),
    );
    expect(harness.session.model?.id).toBe("strict");
    expect(processImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", {
      autoResizeImages: true,
      resizeOptions,
    });
    const userMessage = harness.session.messages.find((message) => message.role === "user");
    expect(userMessage?.content).toContainEqual({
      data: Buffer.from("normalized").toString("base64"),
      mimeType: "image/png",
      type: "image",
    });
  });

const promptsWhileIdleAndRecordsASingle = () => Effect.runPromise(promptsWhileIdleAndRecordsA);

const handlesAToolCallTurnAndWaits = () => Effect.runPromise(handlesAToolCallTurnAnd);

const executesMultipleToolCallsFromOneResponse = () =>
  Effect.runPromise(executesMultipleToolCallsFromOne);

const preservesImageAttachmentsInTheProviderContext = () =>
  Effect.runPromise(preservesImageAttachmentsInTheProvider);

const usesTheModelSelectedByBeforeAgent = () => Effect.runPromise(usesTheModelSelectedByBefore);

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      processImage.mockClear();
      while (harnesses.length > 0) {
        harnesses.pop()?.cleanup();
      }
      while (tempDirs.length > 0) {
        const tempDir = tempDirs.pop();
        if (tempDir !== undefined && tempDir !== "") {
          yield* removePath(tempDir);
        }
      }
    }),
  );

describe("AgentSession prompt characterization", () => {
  afterEach(afterEachHook);

  it("prompts while idle and records a single text response", promptsWhileIdleAndRecordsASingle);

  it(
    "handles a tool call turn and waits for the follow-up LLM response",
    handlesAToolCallTurnAndWaits,
  );

  it(
    "executes multiple tool calls from one response and continues with a single follow-up response",
    executesMultipleToolCallsFromOneResponse,
  );

  it(
    "preserves image attachments in the provider context",
    preservesImageAttachmentsInTheProviderContext,
  );

  it(
    "uses the model selected by before_agent_start for image normalization",
    usesTheModelSelectedByBeforeAgent,
  );
});
