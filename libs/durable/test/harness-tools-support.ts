import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import harnessToolsSupportKit from "./harness-tools-support-kit.ts";
import type harnessToolsSupportTypes from "./harness-tools-support.types.ts";
import sessionSupport from "./session-support.ts";

const { chatSupport, effectSupport } = harnessToolsSupportKit;

const { Type, fauxAssistantMessage, fauxText, fauxToolCall } = ai;

const { ToolResultEntry, defineTool } = durable;
const { MemoryStorage } = memory;

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
  ...list: readonly (readonly [string, Record<string, chordTypes.JsonValue>, string])[]
): aiTypes.AssistantMessage {
  return fauxAssistantMessage(
    list.map(([name, args, id]) => fauxToolCall(name, args, { id })),
    { stopReason: "toolUse" },
  );
}

const DONE = fauxAssistantMessage([fauxText("done")]);

const run = Effect.fn("run")(function* (
  setup: ReturnType<typeof chatSupport.chatSetup>,
  responses: aiTypes.FauxResponseStep[],
  prepare?: (
    harness: harnessToolsSupportTypes.Harness,
    root: harnessToolsSupportTypes.Conversation,
  ) => Promise<void>,
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

function results(
  entries: readonly harnessToolsSupportTypes.EntryRecord[],
): aiTypes.ToolResultMessage[] {
  return entries
    .filter((entry) => ToolResultEntry.is(entry))
    .map((entry) => entry.model![0] as aiTypes.ToolResultMessage);
}

function resultText(message: aiTypes.ToolResultMessage): string {
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
