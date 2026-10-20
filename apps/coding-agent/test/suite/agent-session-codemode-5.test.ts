import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import toolDefinitionWrapper from "../../src/core/tools/tool-definition-wrapper.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import agentSessionCodemodeSupport2 from "./agent-session-codemode-support2.ts";

const { createToolDefinitionFromAgentTool } = toolDefinitionWrapper;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { harnesses, setup } = agentSessionCodemodeSupport2;

const {
  TINY_PNG_BASE64,
  checkSavedImages,
  codemodeResult,
  resultText,
  usage,
  trackCodemodeWorkers,
} = agentSessionCodemodeSupport;

const { fromJsonText } = testing;

trackCodemodeWorkers();

const addsTheUsageOfNestedResults = Effect.gen(function* () {
  const billedTool: agentTypes.AgentTool = {
    description: "Run a model",
    execute: () =>
      Promise.resolve({
        content: [{ text: "ran", type: "text" }],
        details: {},
        usage: usage(100, 0.25),
      }),
    label: "Billed",
    name: "billed",
    parameters: Type.Object({}),
  };
  const harness = yield* setup([
    (msa) => msa.registerTool(createToolDefinitionFromAgentTool(billedTool)),
  ]);
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `await tools.billed({}); await tools.billed({}); await tools.echo({ text: "x" });`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = codemodeResult(harness);
  expect(result.usage).toMatchObject({ cost: { total: 0.5 }, input: 200, totalTokens: 200 });

  const persisted = harness.sessionManager
    .getEntries()
    .find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  expect(
    persisted?.type === "message" &&
      persisted.message.role === "toolResult" &&
      persisted.message.usage,
  ).toEqual(result.usage);
  expect(harness.session.context.stats.getSessionStats().cost).toBe(0.5);
});

const keepsStructuredContentThatToolResult = Effect.gen(function* () {
  const harness = yield* setup([
    (msa) => {
      msa.on("tool_result", (event) =>
        event.toolName === "stats"
          ? {
              content: [{ text: "0 files", type: "text" }],
              structuredContent: { files: 0, names: [] },
            }
          : undefined,
      );

      msa.on("tool_result", (event) =>
        event.toolName === "stats" ? { details: { audited: true } } : undefined,
      );
    },
  ]);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code: "return await tools.stats({});" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));
  expect(yield* fromJsonText(resultText(codemodeResult(harness)))).toEqual({ files: 0, names: [] });
});

const attachesOnlyTheImagesTheScript = Effect.gen(function* () {
  const harness = yield* setup();
  harness.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("codemode", {
          code: `
							// Tools without an outputSchema resolve to their text; images are not passed on.
							const shot = await tools.screenshot({});
							text(shot);
							image("data:image/png;base64,${TINY_PNG_BASE64}");
							image("data:image/png;base64,${TINY_PNG_BASE64}");
							text("after");
						`,
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("go"));

  const result = codemodeResult(harness);

  const lines = resultText(result).split("\n");
  expect(lines).toEqual([
    "==> text 1/2 <==",
    "captured",
    lines[2],
    "<image>",
    lines[2],
    "<image>",
    "==> text 2/2 <==",
    "after",
  ]);
  const savedImageLine = lines[2];
  if (savedImageLine === undefined) throw new Error("expected a saved image line");
  expect(yield* checkSavedImages(savedImageLine)).toBe("<saved>");
  expect(result.content[2]).toEqual({
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
    type: "image",
  });
});

const addsTheUsageOfNestedResultsTo = () => Effect.runPromise(addsTheUsageOfNestedResults);

const keepsStructuredContentThatToolResultHandlers = () =>
  Effect.runPromise(keepsStructuredContentThatToolResult);

const attachesOnlyTheImagesTheScriptPasses = () =>
  Effect.runPromise(attachesOnlyTheImagesTheScript);

describe("AgentSession codemode tool", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("adds the usage of nested results to the codemode result", addsTheUsageOfNestedResultsTo);

  it(
    "keeps structured content that tool_result handlers replace along with the content",
    keepsStructuredContentThatToolResultHandlers,
  );
});

describe("AgentSession codemode tool", () => {
  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it(
    "attaches only the images the script passes to image(), in output order, each after its saved path",
    attachesOnlyTheImagesTheScriptPasses,
  );
});
