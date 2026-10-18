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
  type NestedToolExecutionResult,
  type ToolExecutionResult,
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const Count = Type.Object({ count: Type.Number() });

export function returning(
  name: string,
  result: ToolExecutionResult,
  extra: Partial<ToolRegistration> = {},
): ToolRegistration {
  return defineTool({
    name,
    description: name,
    parameters: Type.Object({}),
    execute: () => Promise.resolve(result),
    ...extra,
  });
}

export function call(name: string): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, {}, { id: "c1" })], { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage([fauxText("done")]);

export const nested = Effect.fn("nested")(function* (setup: ChatSetup, name: string) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let received: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    defineTool({
      name: "probe",
      description: "probe",
      parameters: Type.Object({}),
      execute: (_args, api, callContext) =>
        runPromise(
          Effect.gen(function* () {
            received = yield* awaited(api.executeTool(name, {}, callContext));
            return {};
          }),
        ),
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  yield* awaited(harness.close(context));
  return received!;
});

export const direct = Effect.fn("direct")(function* (setup: ChatSetup, name: string) {
  setup.faux.setResponses([call(name), DONE]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  yield* awaited(harness.close(context));
  return entry.model![0] as ToolResultMessage;
});

export function codes(result: {
  readonly diagnostics?: readonly { readonly code?: string }[];
}): (string | undefined)[] {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}
