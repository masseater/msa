import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type ToolResultMessage,
  Type,
} from "@msa/ai";
import {
  defineTool,
  type EntryRecord,
  type Harness,
  type NestedToolExecutionResult,
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";
import { ToolTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

export type Tool = ToolRegistration<typeof Parameters>;

function toolImpl(name: string, execute: Tool["execute"], extra: Partial<Tool> = {}): Tool {
  return defineTool({ name, description: name, parameters: Parameters, execute, ...extra });
}

export const tool: {
  (execute: Tool["execute"], extra?: Partial<Tool>): (name: string) => ReturnType<typeof toolImpl>;
  (name: string, execute: Tool["execute"], extra?: Partial<Tool>): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

export function echoTool(extra: Partial<Tool> = {}) {
  const state = { runs: 0 };
  const registration = tool(
    "echo",
    (args) => {
      state.runs++;
      return Promise.resolve({ output: [{ type: "text", text: `echo ${args.text ?? ""}` }] });
    },
    extra,
  );
  return { registration, state };
}

function callImpl(name: string, args: Record<string, string> = {}, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
}

export const call: {
  (args?: Record<string, string>, id?: string): (name: string) => ReturnType<typeof callImpl>;
  (name: string, args?: Record<string, string>, id?: string): ReturnType<typeof callImpl>;
} = dual((args) => typeof args[0] === "string", callImpl);

export const DONE = fauxAssistantMessage([fauxText("done")]);

export function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

export function text(result: NestedToolExecutionResult | ToolResultMessage | undefined): string {
  if (result === undefined) return "";
  if (!("role" in result))
    return typeof result.structuredOutput === "string" ? result.structuredOutput : "";
  return result.content.map((item) => (item.type === "text" ? item.text : "")).join("|");
}

export const toolTasks = Effect.fn("toolTasks")(function* (harness: Harness) {
  return (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context),
  )).items;
});

export const runOnce = Effect.fn("runOnce")(function* (
  setup: ChatSetup,
  responses: AssistantMessage[],
) {
  setup.faux.setResponses(responses);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  return { harness, root, status: settled.status, entries: yield* allEntries(root) };
});

export const directories = new Set<string>();
