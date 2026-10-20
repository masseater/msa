import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionPromptSupport from "./agent-session-prompt-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, tempDirs } = agentSessionPromptSupport;

const { createHarness } = harnessModule;

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

const throwsWhenPromptedDuringStreamingWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRelease = gate();
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
  const harness = yield* Effect.promise(() => createHarness({ tools: [waitTool] }));
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

  yield* Effect.promise(() =>
    expect(harness.session.prompt("second")).rejects.toThrow(
      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    ),
  );

  toolRelease.release();
  yield* Effect.promise(() => promptPromise);
});

const throwsWhenPromptedDuringManualCompaction = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const compactionStarted = gate();
  const compactionReleased = gate();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            runPromise(
              Effect.gen(function* () {
                compactionStarted.release();
                yield* Effect.promise(() => compactionReleased);
                return {
                  compaction: {
                    details: {},
                    firstKeptEntryId: event.preparation.firstKeptEntryId,
                    summary: "manual compacted",
                    tokensBefore: event.preparation.tokensBefore,
                  },
                };
              }),
            ),
          );
        },
      ],
      settings: { compaction: { keepRecentTokens: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  const compactPromise = harness.session.compact();
  yield* Effect.promise(() => compactionStarted);

  try {
    yield* Effect.promise(() =>
      expect(harness.session.prompt("third")).rejects.toThrow(
        "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      ),
    );
  } finally {
    compactionReleased.release();
    yield* Effect.promise(() => compactPromise);
  }
});

const throwsWhenPromptingWithoutAModel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.session.agent.state.model = undefined as unknown as aiTypes.Model<any>;

  yield* Effect.promise(() =>
    expect(harness.session.prompt("hi")).rejects.toThrow("No model selected."),
  );
});

const throwsWhenPromptingWithoutConfiguredAuth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);

  yield* Effect.promise(() =>
    expect(harness.session.prompt("hi")).rejects.toThrow(
      `No API key found for ${harness.getModel().provider}.`,
    ),
  );
});

const throwsWhenPromptedDuringStreamingWithoutA = () =>
  Effect.runPromise(throwsWhenPromptedDuringStreamingWithout);

const throwsWhenPromptedDuringManualCompaction2 = () =>
  Effect.runPromise(throwsWhenPromptedDuringManualCompaction);

const throwsWhenPromptingWithoutAModel2 = () => Effect.runPromise(throwsWhenPromptingWithoutAModel);

const throwsWhenPromptingWithoutConfiguredAuth2 = () =>
  Effect.runPromise(throwsWhenPromptingWithoutConfiguredAuth);

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

  it(
    "throws when prompted during streaming without a streamingBehavior",
    throwsWhenPromptedDuringStreamingWithoutA,
  );

  it("throws when prompted during manual compaction", throwsWhenPromptedDuringManualCompaction2);

  it("throws when prompting without a model", throwsWhenPromptingWithoutAModel2);

  it("throws when prompting without configured auth", throwsWhenPromptingWithoutConfiguredAuth2);
});
