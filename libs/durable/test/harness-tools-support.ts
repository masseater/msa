import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type ToolResultMessage,
  Type,
} from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import {
  type Conversation,
  defineTool,
  type EntryRecord,
  type Harness,
  MemoryStorage,
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { context } from "./session-support.ts";

export const EchoParameters = Type.Object({ text: Type.Optional(Type.String()) });

export type Echo = ToolRegistration<typeof EchoParameters>;

export type Execute = Echo["execute"];

export function tool(name: string, execute: Execute, extra: Partial<Echo> = {}): Echo {
  return defineTool({
    name,
    description: `The ${name} tool`,
    parameters: EchoParameters,
    execute,
    ...extra,
  });
}

// A tool-calling answer with one call per `[name, args, id]`.
export function calls(
  ...list: readonly (readonly [string, Record<string, JsonValue>, string])[]
): AssistantMessage {
  return fauxAssistantMessage(
    list.map(([name, args, id]) => fauxToolCall(name, args, { id })),
    { stopReason: "toolUse" },
  );
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export async function run(
  setup: ChatSetup,
  responses: FauxResponseStep[],
  prepare?: (harness: Harness, root: Conversation) => Promise<void>,
  options: Parameters<typeof openChat>[2] = {},
): Promise<{ harness: Harness; root: Conversation; entries: EntryRecord[]; status: string }> {
  setup.faux.setResponses(responses);
  const { harness, root } = await openChat(new MemoryStorage(), setup, options);
  await prepare?.(harness, root);
  const settled = await (
    await root.submit({ type: "input", content: "go" }, context)
  ).wait(context);
  return { harness, root, entries: await allEntries(root), status: settled.status };
}

export function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

export function resultText(message: ToolResultMessage): string {
  return message.content
    .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
    .join("|");
}
