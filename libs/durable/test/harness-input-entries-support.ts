import {
  type AssistantMessage,
  type FauxResponseStep,
  type Context as ModelContext,
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import {
  type Conversation,
  type EntryRecord,
  type Harness,
  InboxDoc,
  LiveDoc,
  defineTool,
} from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import chatSupport from "./chat-support.ts";
import type chatSupportTypes from "./chat-support.types.ts";
import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { textOf, waitFor } = chatSupport;
const { awaited } = effectSupport;
const { addTool } = harnessSupport;
const { context } = sessionSupport;
const { aborted, deferred } = taskSupport;

function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

function gated(message: AssistantMessage): {
  step: FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gate = deferred();
  const step: FauxResponseStep = (_request, options) =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(Promise.race([gate.promise, aborted(options!.signal!)]));
        return message;
      }),
    );
  return { reached: reached.promise, release: () => gate.resolve(), step };
}

function holdToolImpl(setup: chatSupportTypes.ChatSetup, gate: PromiseWithResolvers<void>): void {
  addTool(
    setup.registry,
    defineTool({
      description: "Waits for the test",
      execute: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            return { output: [{ text: "held", type: "text" }] };
          }),
        ),
      name: "hold",
      parameters: Type.Object({}),
    }),
  );
}

const holdTool: {
  (
    gate: PromiseWithResolvers<void>,
  ): (setup: chatSupportTypes.ChatSetup) => ReturnType<typeof holdToolImpl>;
  (
    setup: chatSupportTypes.ChatSetup,
    gate: PromiseWithResolvers<void>,
  ): ReturnType<typeof holdToolImpl>;
} = dual(2, holdToolImpl);

const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

function requestLogImpl(requests: string[][], reply: AssistantMessage): FauxResponseStep {
  return (request: ModelContext) => {
    requests.push(request.messages.map((message) => `${message.role}:${textOf(message) ?? ""}`));
    return reply;
  };
}

const requestLog: {
  (reply: AssistantMessage): (requests: string[][]) => ReturnType<typeof requestLogImpl>;
  (requests: string[][], reply: AssistantMessage): ReturnType<typeof requestLogImpl>;
} = dual(2, requestLogImpl);

function transcript(entries: readonly EntryRecord[]): unknown[][] {
  return entries
    .filter((entry) => entry.kind !== "msa.system")
    .map((entry) => {
      const message = entry.model?.[0];
      const text =
        message === undefined || message.role === "toolResult" ? undefined : textOf(message);
      const row: unknown[] = [entry.kind];
      if (entry.data !== undefined && !entry.kind.startsWith("msa.")) row.push(entry.data);
      if (text !== undefined) row.push(text);
      return row;
    });
}

const inboxItems = Effect.fn("inboxItems")(function* (harness: Harness, root: Conversation) {
  return (yield* awaited(harness.snapshot(InboxDoc, root.id, context)))!.items;
});

const toolRunning = Effect.fn("toolRunning")(function* (harness: Harness, root: Conversation) {
  yield* waitFor(
    Effect.gen(function* () {
      return (
        (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.tools?.[0]?.status ===
        "running"
      );
    }),
  );
});

const mention = (text: string) => ({ data: { author: "ann", text }, kind: "chat.mention" });

const harnessInputEntriesSupport = {
  HOLD,
  answer,
  gated,
  holdTool,
  inboxItems,
  mention,
  requestLog,
  toolRunning,
  transcript,
};

export default harnessInputEntriesSupport;
