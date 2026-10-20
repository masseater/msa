import type agentTypes from "@msa/agent-core/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { createToolDefinitionFromAgentTool } from "../../src/core/tools/tool-definition-wrapper.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import agentSessionCodemodeSupport from "./agent-session-codemode-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { awaited } = testing;

const { TINY_PNG_BASE64 } = agentSessionCodemodeSupport;

const { createHarness } = harnessModule;

const echoSchema = Type.Object({ text: Type.String({ description: "Text to echo" }) });

const echoTool: agentTypes.AgentTool<typeof echoSchema> = {
  description: "Echo text back.\n\nSecond paragraph.",
  execute: (_id, params) =>
    Promise.resolve({
      content: [{ text: `echo: ${params.text}`, type: "text" }],
      details: {},
    }),
  label: "Echo",
  name: "echo",
  parameters: echoSchema,
};

const statsTool: agentTypes.AgentTool = {
  description: "Return structured stats",
  execute: () =>
    Promise.resolve({
      content: [{ text: "2 files", type: "text" }],
      details: {},
      structuredContent: { files: 2, names: ["a", "b"] },
    }),
  label: "Stats",
  name: "stats",
  outputSchema: Type.Object({ files: Type.Number(), names: Type.Array(Type.String()) }),
  parameters: Type.Object({}),
};

const screenshotTool: agentTypes.AgentTool = {
  description: "Return a screenshot",
  execute: () =>
    Promise.resolve({
      content: [
        { text: "captured", type: "text" },
        { data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" },
      ],
      details: {},
    }),
  label: "Screenshot",
  name: "screenshot",
  parameters: Type.Object({}),
};

const harnesses: harnessTypes.Harness[] = [];

const registerTools = (msa: ExtensionAPI) => {
  for (const tool of [echoTool as agentTypes.AgentTool, statsTool, screenshotTool]) {
    msa.registerTool(createToolDefinitionFromAgentTool(tool));
  }
};

const setup = Effect.fn("setup")(function* (
  extensionFactories?: harnessTypes.HarnessOptions["extensionFactories"],
) {
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [createCodemodeExtension(), registerTools, ...(extensionFactories ?? [])],
      initialActiveToolNames: ["codemode"],
    }),
  );
  harnesses.push(harness);
  return harness;
});

const agentSessionCodemodeSupport2 = {
  echoSchema,
  echoTool,
  harnesses,
  setup,
  statsTool,
};

export default agentSessionCodemodeSupport2;
