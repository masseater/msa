import { type AssistantMessage, Type, fauxAssistantMessage, fauxText, fauxToolCall } from "@msa/ai";
import {
  type Conversation,
  type EntryRecord,
  type JsonObject,
  type ToolRegistration,
  defineTool,
} from "@msa/durable";
import { Effect } from "effect";

import { createToolSearchExtension } from "../src/tool-search/index.ts";
import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSetup } = chatSupport;

const { awaited } = effectSupport;

const { addTool } = harnessSupport;

const { context } = sessionSupport;

function tool(
  name: string,
  description: string,
  extra: Partial<ToolRegistration> = {},
): ToolRegistration {
  return defineTool({
    description,
    execute: () => Promise.resolve({ output: [{ text: `${name} ran`, type: "text" }] }),
    name,
    parameters: Type.Object({
      number: Type.Optional(Type.Number({ description: "Issue number" })),
    }),
    ...extra,
  });
}

const DONE = fauxAssistantMessage([fauxText("done")]);

function call(name: string, args: JsonObject = {}, id = "c1"): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
}

function setup(): ReturnType<typeof chatSetup> {
  const chat = chatSetup();
  addTool(chat.registry, tool("alpha", "Alpha tool"));
  addTool(
    chat.registry,
    tool("github_get_issue", "Get a GitHub issue by number", { deferred: true }),
  );
  addTool(
    chat.registry,
    tool("github_list_repos", "List the repositories of a user", { deferred: true }),
  );
  addTool(chat.registry, tool("omega", "Omega tool"));
  chat.registry.install(createToolSearchExtension());
  return chat;
}

const offered = Effect.fn("offered")(function* (root: Conversation) {
  return (yield* awaited(root.agent(context))).tools.map((each) => each.name);
});

function systemMessages(entries: readonly EntryRecord[]) {
  return entries
    .filter((entry) => entry.kind === "msa.system")
    .map(
      (entry) =>
        entry.model![0] as { toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] },
    );
}

function toolResultTexts(entries: readonly EntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.kind === "msa.tool-result")
    .map((entry) =>
      (entry.model![0] as { content: { text?: string }[] }).content
        .map((item) => item.text)
        .join(""),
    );
}

const toolSearchSupport = {
  DONE,
  call,
  offered,
  setup,
  systemMessages,
  tool,
  toolResultTexts,
};

export default toolSearchSupport;
