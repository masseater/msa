import { Data, Effect } from "effect";
import { Type } from "typebox";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { streamSimple } = compatModule;

class PayloadCaptured extends Data.TaggedError("PayloadCaptured") {}

function tool(name: string): typesModule.Tool {
  return { description: `${name} tool`, name, parameters: Type.Object({}) };
}

const capturePayload = Effect.fn("capturePayload")(function* <T>(
  model: typesModule.Model<typesModule.Api>,
  context: typesModule.Context,
) {
  let captured: T | undefined;
  const stream = streamSimple(model, context, {
    apiKey: "test-key",
    onPayload: (payload) => {
      captured = payload as T;
      throw new PayloadCaptured();
    },
  });
  yield* Effect.promise(() => stream.result());
  if (captured === undefined) throw new Error("Expected payload capture");
  return captured;
});

const modelBase = {
  baseUrl: "http://127.0.0.1:9",
  contextWindow: 100000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  input: ["text"] as ("text" | "image")[],
  maxTokens: 1000,
  reasoning: true,
};

const baseTool = tool("base_tool");

const lateTool = tool("late_tool");

const context: typesModule.Context = {
  messages: [
    {
      content: "base prompt",
      role: "system",
      sections: Object.fromEntries([
        ["rules", "<rules>\nold rules\n</rules>"],
        ["docs", "<docs>\nread docs\n</docs>"],
      ]),
      timestamp: 0,
      toolsAdded: [baseTool],
    },
    { content: "before", role: "user", timestamp: 1 },
    {
      content: "updated guidance",
      role: "system",
      sections: Object.fromEntries([
        ["rules", "<rules>\nnew rules\n</rules>"],
        ["docs", null],
      ]),
      timestamp: 2,
      toolsAdded: [lateTool],
      toolsRemoved: [{ name: "base_tool" }],
    },
  ],
};

const additionContext: typesModule.Context = {
  messages: [
    { content: "base prompt", role: "system", timestamp: 0, toolsAdded: [baseTool] },
    { content: "before", role: "user", timestamp: 1 },
    { content: "updated guidance", role: "system", timestamp: 2, toolsAdded: [lateTool] },
  ],
};

const anthropicNativeModel: typesModule.Model<"anthropic-messages"> = {
  ...modelBase,
  api: "anthropic-messages",
  compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true },
  id: "claude-opus-5",
  name: "Claude Opus 5",
  provider: "anthropic-api",
};

const transcriptToolChangesSupport = {
  PayloadCaptured,
  additionContext,
  anthropicNativeModel,
  baseTool,
  capturePayload,
  context,
  lateTool,
  modelBase,
  tool,
};

export default transcriptToolChangesSupport;
