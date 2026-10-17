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
  MemoryStorage,
  type NestedToolExecutionResult,
  type ToolExecutionResult,
  type ToolRegistration,
  ToolResultEntry,
} from "@msa/durable";

import { allEntries, type ChatSetup, openChat } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const Count = Type.Object({ count: Type.Number() });

// A tool that returns `result`, with `extra` such as a schema.
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

// Run `name` as a nested call of a `probe` tool and return what the probe received.
export async function nested(setup: ChatSetup, name: string): Promise<NestedToolExecutionResult> {
  let received: NestedToolExecutionResult | undefined;
  addTool(
    setup.registry,
    defineTool({
      name: "probe",
      description: "probe",
      parameters: Type.Object({}),
      execute: async (_args, api, callContext) => {
        received = await api.executeTool(name, {}, callContext);
        return {};
      },
    }),
  );
  setup.faux.setResponses([call("probe"), DONE]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
  await harness.close(context);
  return received!;
}

// Run `name` as a model-issued call and return its transcript message.
export async function direct(setup: ChatSetup, name: string): Promise<ToolResultMessage> {
  setup.faux.setResponses([call(name), DONE]);
  const { harness, root } = await openChat(new MemoryStorage(), setup);
  await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
  const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  await harness.close(context);
  return entry.model![0] as ToolResultMessage;
}

export function codes(result: {
  readonly diagnostics?: readonly { readonly code?: string }[];
}): (string | undefined)[] {
  return (result.diagnostics ?? []).map((diagnostic) => diagnostic.code);
}
