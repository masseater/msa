import {
  type AssistantMessage,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  Type,
} from "@msa/ai";
import {
  type Conversation,
  defineTool,
  type EntryRecord,
  type Harness,
  InboxDoc,
  LiveDoc,
  type Submission,
  type SubmissionRecord,
  type ToolExecutionResult,
} from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { type ChatSetup, textOf, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export const directories = new Set<string>();

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

function holdToolImpl(
  setup: ChatSetup,
  gate: Deferred,
  result: ToolExecutionResult = { output: [] },
): void {
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
            return result;
          }),
        ),
    }),
  );
}

export const holdTool: {
  (
    gate: Deferred,
    result?: ToolExecutionResult,
  ): (setup: ChatSetup) => ReturnType<typeof holdToolImpl>;
  (setup: ChatSetup, gate: Deferred, result?: ToolExecutionResult): ReturnType<typeof holdToolImpl>;
} = dual((args) => "registry" in args[0], holdToolImpl);

export function queuedNote(text: string) {
  return { kind: "note", model: [{ role: "user", content: text, timestamp: 0 }] } as const;
}

export const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

export function status(submission: Submission): Promise<SubmissionRecord> {
  return Promise.resolve(submission.status(context));
}

export function transcript(entries: readonly EntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.kind !== "msa.system")
    .map((entry) => {
      const message = entry.model?.[0];
      const text = message?.role === "toolResult" ? undefined : textOf(message);
      return text === undefined ? entry.kind : `${entry.kind}:${text}`;
    });
}

export const inbox = Effect.fn("inbox")(function* (harness: Harness, root: Conversation) {
  return (yield* awaited(harness.snapshot(InboxDoc, root.id, context)))!.items.map((item) => [
    item.id,
    item.mode,
  ]);
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
