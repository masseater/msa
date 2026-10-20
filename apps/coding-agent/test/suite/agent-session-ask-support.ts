import { type TranscriptContext, getCurrentTools } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import type { ExtensionFactory, ToolDefinition } from "../../src/index.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { awaited } = testing;

const { createHarness } = harnessModule;

const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "memory",
  "pr_watch",
  "model_policy",
  "model_upgrade",
];

const READ_ONLY_BUILTINS = ["read", "grep", "find", "ls"];

const WRITING_BUILTINS = ["bash", "edit", "write"];

const harnesses: harnessTypes.Harness[] = [];

const setup = Effect.fn("setup")(function* () {
  const ran: string[] = [];
  const tool = (name: string, annotations?: ToolDefinition["annotations"]): ToolDefinition => ({
    description: `${name} description`,
    execute: () => {
      ran.push(name);
      return Promise.resolve({ content: [{ text: name, type: "text" as const }], details: {} });
    },
    label: name,
    name,
    parameters: Type.Object({}),
    promptSnippet: `${name} snippet`,
    ...(annotations === undefined ? {} : { annotations }),
  });
  const extension: ExtensionFactory = (msa) => {
    msa.registerTool(tool("lookup", { readOnlyHint: true }));
    msa.registerTool(tool("deploy"));
  };
  const harness = yield* awaited(
    createHarness({
      extensionFactories: [extension],
      initialActiveToolNames: [...BUILTIN_TOOLS, "lookup", "deploy"],
    }),
  );
  harnesses.push(harness);
  return { harness, ran };
});

function record(
  harness: harnessTypes.Harness,
  responses: Parameters<harnessTypes.Harness["setResponses"]>[0],
) {
  const requests: TranscriptContext[] = [];
  harness.setResponses(
    responses.map((response) => (context: TranscriptContext) => {
      requests.push(context);
      return typeof response === "function"
        ? response(context, undefined, harness.faux.state, harness.getModel())
        : response;
    }),
  );
  return requests;
}

const declared = (request: TranscriptContext | undefined) =>
  getCurrentTools(request?.messages ?? []).map((tool) => tool.name);

const cleanupHarnesses = (): void => {
  while (harnesses.length > 0) harnesses.pop()?.cleanup();
};

const agentSessionAskSupport = {
  BUILTIN_TOOLS,
  READ_ONLY_BUILTINS,
  WRITING_BUILTINS,
  cleanupHarnesses,
  declared,
  harnesses,
  record,
  setup,
};

export default agentSessionAskSupport;
