import {
  type AssistantMessage,
  type ToolResultMessage,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import {
  type NestedToolExecutionResult,
  type ToolExecutionResult,
  type ToolRegistration,
  ToolResultEntry,
  defineTool,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import type chatSupportTypes from "./chat-support.types.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { allEntries, openChat } = chatSupport;
const { awaited } = effectSupport;
const { addTool } = harnessSupport;
const { context } = sessionSupport;

const Count = Type.Object({ count: Type.Number() });

function returningImpl(
  name: string,
  result: ToolExecutionResult,
  extra: Partial<ToolRegistration> = {},
): ToolRegistration {
  return defineTool({
    description: name,
    execute: () => Promise.resolve(result),
    name,
    parameters: Type.Object({}),
    ...extra,
  });
}

const returning: {
  (
    result: ToolExecutionResult,
    extra?: Partial<ToolRegistration>,
  ): (name: string) => ReturnType<typeof returningImpl>;
  (
    name: string,
    result: ToolExecutionResult,
    extra?: Partial<ToolRegistration>,
  ): ReturnType<typeof returningImpl>;
} = dual((args) => typeof args[0] === "string", returningImpl);

function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

const nested = Effect.fn("nested")(function* (setup: chatSupportTypes.ChatSetup, name: string) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let received: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    defineTool({
      description: "probe",
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            received = yield* awaited(api.executeTool(name, {}, callContext));
            return {};
          }),
        ),
      name: "probe",
      parameters: Type.Object({}),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  yield* awaited(harness.close(context));
  return received!;
});

const direct = Effect.fn("direct")(function* (setup: chatSupportTypes.ChatSetup, name: string) {
  setup.faux.setResponses([call(name), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  yield* awaited(harness.close(context));
  return entry.model![0] as ToolResultMessage;
});

function codes(result: {
  readonly diagnostics?: readonly { readonly code?: string }[];
}): (string | undefined)[] {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}

const harnessStructuredOutputSupport = {
  Count,
  DONE,
  call,
  codes,
  direct,
  nested,
  returning,
};

export default harnessStructuredOutputSupport;
