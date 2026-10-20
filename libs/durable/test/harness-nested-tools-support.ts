import {
  type AssistantMessage,
  type ToolResultMessage,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import {
  type EntryRecord,
  type Harness,
  type NestedToolExecutionResult,
  ToolResultEntry,
  defineTool,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import type harnessNestedToolsSupportTypes from "./harness-nested-tools-support.types.ts";
import sessionSupport from "./session-support.ts";

const { allEntries, openChat } = chatSupport;
const { awaited } = effectSupport;
const { context } = sessionSupport;

const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

function toolImpl(
  name: string,
  execute: harnessNestedToolsSupportTypes.Tool["execute"],
  extra: Partial<harnessNestedToolsSupportTypes.Tool> = {},
): harnessNestedToolsSupportTypes.Tool {
  return defineTool({ description: name, execute, name, parameters: Parameters, ...extra });
}

const tool: {
  (
    execute: harnessNestedToolsSupportTypes.Tool["execute"],
    extra?: Partial<harnessNestedToolsSupportTypes.Tool>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: harnessNestedToolsSupportTypes.Tool["execute"],
    extra?: Partial<harnessNestedToolsSupportTypes.Tool>,
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function echoTool(extra: Partial<harnessNestedToolsSupportTypes.Tool> = {}) {
  const state = { runs: 0 };
  const registration = tool(
    "echo",
    (args) => {
      state.runs++;
      return Promise.resolve({ output: [{ text: `echo ${args.text ?? ""}`, type: "text" }] });
    },
    extra,
  );
  return { registration, state };
}

function callImpl(name: string, args: Record<string, string> = {}, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
}

const call: {
  (args?: Record<string, string>, id?: string): (name: string) => ReturnType<typeof callImpl>;
  (name: string, args?: Record<string, string>, id?: string): ReturnType<typeof callImpl>;
} = dual((args) => typeof args[0] === "string", callImpl);

const DONE = fauxAssistantMessage([fauxText("done")]);

function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

function text(result: NestedToolExecutionResult | ToolResultMessage | undefined): string {
  if (result === undefined) return "";
  if (!("role" in result))
    return typeof result.structuredOutput === "string" ? result.structuredOutput : "";
  return result.content.map((item) => (item.type === "text" ? item.text : "")).join("|");
}

const toolTasks = Effect.fn("toolTasks")(function* (harness: Harness) {
  return (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
});

const runOnce = Effect.fn("runOnce")(function* (
  setup: ReturnType<typeof chatSupport.chatSetup>,
  responses: AssistantMessage[],
) {
  setup.faux.setResponses(responses);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  return { entries: yield* allEntries(root), harness, root, status: settled.status };
});

const directories = new Set<string>();

const harnessNestedToolsSupport = {
  DONE,
  Parameters,
  call,
  directories,
  echoTool,
  results,
  runOnce,
  text,
  tool,
  toolTasks,
};

export default harnessNestedToolsSupport;
