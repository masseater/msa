import {
  type AssistantMessage,
  type ToolResultMessage,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type chatSupportTypes from "./chat-support.types.ts";
import testSupport from "./support.ts";

const { ToolResultEntry, defineTool } = durable;
const { MemoryStorage } = memory;

const { allEntries, openChat } = testSupport;
const { awaited } = testSupport;
const { addTool } = testSupport;
const { context } = testSupport;

const Count = Type.Object({ count: Type.Number() });

function returningImpl(
  name: string,
  result: durableTypes.ToolExecutionResult,
  extra: Partial<durableTypes.ToolRegistration> = {},
): durableTypes.ToolRegistration {
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
    result: durableTypes.ToolExecutionResult,
    extra?: Partial<durableTypes.ToolRegistration>,
  ): (name: string) => ReturnType<typeof returningImpl>;
  (
    name: string,
    result: durableTypes.ToolExecutionResult,
    extra?: Partial<durableTypes.ToolRegistration>,
  ): ReturnType<typeof returningImpl>;
} = dual((args) => typeof args[0] === "string", returningImpl);

function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

const nested = Effect.fn("nested")(function* (setup: chatSupportTypes.ChatSetup, name: string) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let received: durableTypes.NestedToolExecutionResult | undefined;
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
