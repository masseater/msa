import {
  type AssistantMessage,
  type FauxResponseStep,
  type ToolResultMessage,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import type { JsonValue } from "@msa/chord";
import {
  type Conversation,
  type EntryRecord,
  type Harness,
  ToolResultEntry,
  defineTool,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import type harnessToolsSupportTypes from "./harness-tools-support.types.ts";
import sessionSupport from "./session-support.ts";

const { allEntries, openChat } = chatSupport;
const { awaited } = effectSupport;
const { context } = sessionSupport;

const EchoParameters = Type.Object({ text: Type.Optional(Type.String()) });

function toolImpl(
  name: string,
  execute: harnessToolsSupportTypes.Execute,
  extra: Partial<harnessToolsSupportTypes.Echo> = {},
): harnessToolsSupportTypes.Echo {
  return defineTool({
    description: `The ${name} tool`,
    execute,
    name,
    parameters: EchoParameters,
    ...extra,
  });
}

const tool: {
  (
    execute: harnessToolsSupportTypes.Execute,
    extra?: Partial<harnessToolsSupportTypes.Echo>,
  ): (name: string) => ReturnType<typeof toolImpl>;
  (
    name: string,
    execute: harnessToolsSupportTypes.Execute,
    extra?: Partial<harnessToolsSupportTypes.Echo>,
  ): ReturnType<typeof toolImpl>;
} = dual((args) => typeof args[0] === "string", toolImpl);

function calls(
  ...list: readonly (readonly [string, Record<string, JsonValue>, string])[]
): AssistantMessage {
  return fauxAssistantMessage(
    list.map(([name, args, id]) => fauxToolCall(name, args, { id })),
    { stopReason: "toolUse" },
  );
}

const DONE = fauxAssistantMessage([fauxText("done")]);

const run = Effect.fn("run")(function* (
  setup: ReturnType<typeof chatSupport.chatSetup>,
  responses: FauxResponseStep[],
  prepare?: (harness: Harness, root: Conversation) => Promise<void>,
  options: Parameters<typeof openChat>[2] = {},
) {
  setup.faux.setResponses(responses);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup, options);
  yield* awaited(prepare?.(harness, root));
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  return { entries: yield* allEntries(root), harness, root, status: settled.status };
});

function results(entries: readonly EntryRecord[]): ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as ToolResultMessage);
}

function resultText(message: ToolResultMessage): string {
  return message.content
    .map((item) => (item.type === "text" ? item.text : `[${item.type}]`))
    .join("|");
}

const harnessToolsSupport = {
  DONE,
  EchoParameters,
  calls,
  resultText,
  results,
  run,
  tool,
};

export default harnessToolsSupport;
