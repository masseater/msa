import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypes from "../../src/core/extensions/index.types.ts";
import agentSessionPromptSupport from "./agent-session-prompt-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } = ai;

const { harnesses, tempDirs } = agentSessionPromptSupport;

const { createHarness } = harnessModule;

const { gate, removePath, runTest, toJsonText } = testing;

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

const keepsTheSameSystemPromptFor = Effect.gen(function* () {
  const events: extensionsTypes.BeforeAgentStartEvent[] = [];
  const noopTool: agentTypes.AgentTool = {
    description: "Does nothing",
    execute: () => Promise.resolve({ content: [{ text: "ok", type: "text" }], details: {} }),
    label: "Noop",
    name: "noop",
    parameters: Type.Object({}),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", (event) => {
            events.push(event);
            event.systemPromptOptions.sections["extension_rules"] = "Answer in one word.";
          });
        },
      ],
      tools: [noopTool],
    }),
  );
  harnesses.push(harness);
  const prompts: string[] = [];
  const record =
    (response: ReturnType<typeof fauxAssistantMessage>) => (context: aiTypes.TranscriptContext) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return response;
    };
  harness.setResponses([
    record(fauxAssistantMessage("hi")),
    record(fauxAssistantMessage([fauxToolCall("noop", {})], { stopReason: "toolUse" })),
    record(fauxAssistantMessage("done")),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));
  yield* Effect.promise(() =>
    harness.session.run.prompting.sendCustomMessage(
      { content: "background task finished", customType: "task-done", display: true },
      { triggerTurn: true },
    ),
  );

  expect(prompts).toHaveLength(3);
  expect(prompts[0]).toContain("Answer in one word.");
  expect(new Set(prompts).size).toBe(1);
  expect(events.map((event) => event.messageType)).toEqual(["user", "custom"]);
  const customEvent = events[1];
  expect(customEvent?.messageType === "custom" && customEvent.message.customType).toBe("task-done");
});

const queuesACustomMessageSentWhilePart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    let releaseHandler: () => void = () => {};
    const handlerStarted = Promise.withResolvers<void>();
    const harness = yield* Effect.promise(() =>
      createHarness({
        extensionFactories: [
          (msa) => {
            msa.on("before_agent_start", (event) =>
              runPromise(
                Effect.gen(function* () {
                  if (event.messageType !== "custom" || event.message.customType !== "first")
                    return;
                  handlerStarted.resolve();
                  const handlerGate = gate();
                  releaseHandler = () => handlerGate.release();
                  yield* Effect.promise(() => handlerGate);
                }),
              ),
            );
          },
        ],
      }),
    );
    harnesses.push(harness);
    const requests: aiTypes.TranscriptContext[] = [];
    harness.setResponses([
      (context) => {
        requests.push(context);
        return fauxAssistantMessage("handled both");
      },
    ]);

    const first = harness.session.run.prompting.sendCustomMessage(
      { content: "task one finished", customType: "first", display: true },
      { triggerTurn: true },
    );
    yield* Effect.promise(() => handlerStarted.promise);
    expect(harness.session.isIdle).toBe(false);
    const second = harness.session.run.prompting.sendCustomMessage(
      { content: "task two finished", customType: "second", display: true },
      { triggerTurn: true },
    );
    releaseHandler();
    return { first, requests, second };
  });

const queuesACustomMessageSentWhile = Effect.gen(function* () {
  const { first, requests, second } = yield* queuesACustomMessageSentWhilePart1();
  yield* Effect.promise(() => Promise.all([first, second]));

  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (request === undefined) throw new Error("expected one request");
  const texts = request.messages.flatMap((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
      : [],
  );
  expect(texts).toEqual(["task one finished", "task two finished"]);
});

const includesACustomMessageSentWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () => {
            msa.sendMessage(
              { content: "context from handler", customType: "note", display: true },
              { triggerTurn: false },
            );
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  const requests: aiTypes.TranscriptContext[] = [];
  harness.setResponses([
    (context) => {
      requests.push(context);
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("hello"));

  expect(requests).toHaveLength(1);
  expect(yield* toJsonText(requests[0]?.messages)).toContain("context from handler");
});

const abortsARunWhenAbortIs = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let releaseHandler: () => void = () => {};
  const handlerStarted = Promise.withResolvers<void>();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () =>
            runPromise(
              Effect.gen(function* () {
                handlerStarted.resolve();
                const handlerGate = gate();
                releaseHandler = () => handlerGate.release();
                yield* Effect.promise(() => handlerGate);
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("should not complete")]);

  const run = harness.session.run.prompting.sendCustomMessage(
    { content: "background task finished", customType: "task-done", display: true },
    { triggerTurn: true },
  );
  yield* Effect.promise(() => handlerStarted.promise);
  const aborted = harness.session.run.lifecycle.abort();
  releaseHandler();
  yield* Effect.promise(() => Promise.all([run, aborted]));

  const last = harness.session.messages.at(-1);
  expect(last?.role).toBe("assistant");
  expect(last?.role === "assistant" && last.stopReason).toBe("aborted");
  expect(harness.session.isIdle).toBe(true);
});

const keepsTheSameSystemPromptForEvery = () => Effect.runPromise(keepsTheSameSystemPromptFor);

const queuesACustomMessageSentWhileBefore = () => Effect.runPromise(queuesACustomMessageSentWhile);

const includesACustomMessageSentWithoutTriggerturn = () =>
  Effect.runPromise(includesACustomMessageSentWithout);

const abortsARunWhenAbortIsRequested = () => Effect.runPromise(abortsARunWhenAbortIs);

const afterEachHook4 = () =>
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
  afterEach(afterEachHook4);

  describe("runs started by a custom message", () => {
    it(
      "keeps the same system prompt for every request of the run",
      keepsTheSameSystemPromptForEvery,
    );
    it(
      "queues a custom message sent while before_agent_start runs into the starting run",
      queuesACustomMessageSentWhileBefore,
    );
    it(
      "includes a custom message sent without triggerTurn while the run starts in its first request",
      includesACustomMessageSentWithoutTriggerturn,
    );
    it(
      "aborts a run when abort is requested while before_agent_start runs",
      abortsARunWhenAbortIsRequested,
    );
  });
});
