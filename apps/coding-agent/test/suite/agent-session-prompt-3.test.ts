import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { InputEvent } from "../../src/core/extensions/index.ts";
import agentSessionPromptSupport from "./agent-session-prompt-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, tempDirs } = agentSessionPromptSupport;

const { createHarness, getMessageText } = harnessModule;

const { gate, removePath, runTest } = testing;

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

vi.mock("../../src/utils/image-process.ts", () => ({ processImage }));

const sendusermessageWhileIdleTriggersATurn = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("response")]);

  yield* Effect.promise(() => harness.session.sendUserMessage("from extension"));

  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
  ]);
  expect(getMessageText(harness.session.messages[1]!)).toBe("from extension");
});

const doesNotReportStreamingbehaviorToInput = Effect.gen(function* () {
  const inputEvents: InputEvent[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("input", (event) => {
            inputEvents.push(event);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("ok")]);

  yield* Effect.promise(() => harness.session.prompt("idle", { streamingBehavior: "followUp" }));

  expect(inputEvents).toHaveLength(1);
  expect(inputEvents[0]?.streamingBehavior).toBeUndefined();
});

const reportsStreamingbehaviorToInputHandlersWhilePart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const toolRelease = gate();
    const inputEvents: InputEvent[] = [];
    const waitTool: agentTypes.AgentTool = {
      description: "Wait for release",
      execute: () =>
        runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => toolRelease);
            return {
              content: [{ text: "released", type: "text" }],
              details: {},
            };
          }),
        ),
      label: "Wait",
      name: "wait",
      parameters: Type.Object({}),
    };
    return { inputEvents, toolRelease, waitTool };
  });

const reportsStreamingbehaviorToInputHandlersWhile = Effect.gen(function* () {
  const { inputEvents, toolRelease, waitTool } =
    yield* reportsStreamingbehaviorToInputHandlersWhilePart1();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("input", (event) => {
            inputEvents.push(event);
          });
        },
      ],
      tools: [waitTool],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  const sawToolStart = gate();
  {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        unsubscribe();
        sawToolStart.release();
      }
    });
  }

  const promptPromise = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  yield* Effect.promise(() => harness.session.prompt("queued", { streamingBehavior: "followUp" }));

  expect(inputEvents.map((event) => event.streamingBehavior)).toEqual([undefined, "followUp"]);

  toolRelease.release();
  yield* Effect.promise(() => promptPromise);
});

const sendusermessageWhileIdleTriggersATurn2 = () =>
  Effect.runPromise(sendusermessageWhileIdleTriggersATurn);

const doesNotReportStreamingbehaviorToInputHandlers = () =>
  Effect.runPromise(doesNotReportStreamingbehaviorToInput);

const reportsStreamingbehaviorToInputHandlersWhileStreaming = () =>
  Effect.runPromise(reportsStreamingbehaviorToInputHandlersWhile);

const afterEachHook3 = () =>
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
  afterEach(afterEachHook3);

  it("sendUserMessage while idle triggers a turn", sendusermessageWhileIdleTriggersATurn2);

  it(
    "does not report streamingBehavior to input handlers while idle",
    doesNotReportStreamingbehaviorToInputHandlers,
  );

  it(
    "reports streamingBehavior to input handlers while streaming",
    reportsStreamingbehaviorToInputHandlersWhileStreaming,
  );
});
