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
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export const EchoParameters = Type.Object({ text: Type.Optional(Type.String()) });

export type Echo = ToolRegistration<typeof EchoParameters>;

export type Execute = Echo["execute"];

function toolImpl(name: string, execute: Execute, extra: Partial<Echo> = {}): Echo {
  return defineTool({
    name,
    description: `The ${name} tool`,
    parameters: EchoParameters,
    execute,
    ...extra,
  });
}

export const tool: {
  (execute: Execute, extra?: Partial<Echo>): (name: string) => ReturnType<typeof toolImpl>;
  (name: string, execute: Execute, extra?: Partial<Echo>): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

export function calls(
  ...list: readonly (readonly [string, Record<string, JsonValue>, string])[]
): AssistantMessage {
  return fauxAssistantMessage(
    list.map(([name, args, id]) => fauxToolCall(name, args, { id })),
    { stopReason: "toolUse" },
  );
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export const run = Effect.fn("run")(function* (
  setup: ChatSetup,
  responses: FauxResponseStep[],
  prepare?: (harness: Harness, root: Conversation) => Promise<void>,
  options: Parameters<typeof openChat>[2] = {},
) {
  setup.faux.setResponses(responses);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup, options);
  yield* awaited(prepare?.(harness, root));
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  return { harness, root, entries: yield* allEntries(root), status: settled.status };
});

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
