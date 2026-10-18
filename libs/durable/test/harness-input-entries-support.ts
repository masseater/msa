import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type Context as ModelContext,
  Type,
} from "@msa/ai";
import {
  type Conversation,
  defineTool,
  type EntryRecord,
  type Harness,
  InboxDoc,
  LiveDoc,
} from "@msa/durable";
import { Effect } from "effect";

import { type ChatSetup, textOf, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

export function gated(message: AssistantMessage): {
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
  return { step, reached: reached.promise, release: () => gate.resolve() };
}

export function holdTool(setup: ChatSetup, gate: Deferred): void {
  addTool(
    setup.registry,
    defineTool({
      name: "hold",
      description: "Waits for the test",
      parameters: Type.Object({}),
      execute: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            return { output: [{ type: "text", text: "held" }] };
          }),
        ),
    }),
  );
}

export const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

export function requestLog(requests: string[][], reply: AssistantMessage): FauxResponseStep {
  return (request: ModelContext) => {
    requests.push(request.messages.map((message) => `${message.role}:${textOf(message) ?? ""}`));
    return reply;
  };
}

export function transcript(entries: readonly EntryRecord[]): unknown[][] {
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

export const inboxItems = Effect.fn("inboxItems")(function* (harness: Harness, root: Conversation) {
  return (yield* awaited(harness.snapshot(InboxDoc, root.id, context)))!.items;
});

export const toolRunning = Effect.fn("toolRunning")(function* (
  harness: Harness,
  root: Conversation,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (
          (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))?.tools?.[0]?.status ===
          "running"
        );
      }),
    ),
  );
});

export const mention = (text: string) => ({ kind: "chat.mention", data: { author: "ann", text } });
