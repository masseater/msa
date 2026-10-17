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
  MemoryStorage,
  type NestedToolExecutionResult,
  type ToolRegistration,
  ToolResultEntry,
  ToolTask,
} from "@msa/durable";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { context } from "./session-support.ts";

export const Parameters = Type.Object({ text: Type.Optional(Type.String()) });

export type Tool = ToolRegistration<typeof Parameters>;

export function tool(name: string, execute: Tool["execute"], extra: Partial<Tool> = {}): Tool {
  return defineTool({ name, description: name, parameters: Parameters, execute, ...extra });
}

// Returns `echo <text>` and counts its runs.
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

export function call(name: string, args: Record<string, string> = {}, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

// The text of a result message, or the value a schema-less nested call gives programs.
export function text(result: NestedToolExecutionResult | ToolResultMessage | undefined): string {
  if (result === undefined) return "";
  if (!("role" in result))
    return typeof result.structuredOutput === "string" ? result.structuredOutput : "";
  return result.content.map((item) => (item.type === "text" ? item.text : "")).join("|");
}

export async function toolTasks(harness: Harness) {
  return (
    await harness.commit((tx) => tx.scanTasks({ kind: ToolTask.definition.name }, 100), context)
  ).items;
}

export async function runOnce(setup: ChatSetup, responses: AssistantMessage[]) {
  setup.faux.setResponses(responses);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  const settled = await (
    await root.submit({ type: "input", content: "go" }, context)
  ).wait(context);
  return { harness, root, status: settled.status, entries: await allEntries(root) };
}

export const directories = new Set<string>();
