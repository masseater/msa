import {
  type AssistantMessage,
  type FauxResponseStep,
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
  type Submission,
  type SubmissionRecord,
  type ToolExecutionResult,
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

const directories = new Set<string>();

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

function holdToolImpl(
  setup: chatSupportTypes.ChatSetup,
  gate: PromiseWithResolvers<void>,
  result: ToolExecutionResult = { output: [] },
): void {
  addTool(
    setup.registry,
    defineTool({
      description: "Waits for the test",
      execute: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            return result;
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
    result?: ToolExecutionResult,
  ): (setup: chatSupportTypes.ChatSetup) => ReturnType<typeof holdToolImpl>;
  (
    setup: chatSupportTypes.ChatSetup,
    gate: PromiseWithResolvers<void>,
    result?: ToolExecutionResult,
  ): ReturnType<typeof holdToolImpl>;
} = dual((args) => "registry" in args[0], holdToolImpl);

function queuedNote(text: string) {
  return { kind: "note", model: [{ content: text, role: "user", timestamp: 0 }] } as const;
}

const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

function status(submission: Submission): Promise<SubmissionRecord> {
  return Promise.resolve(submission.status(context));
}

function transcript(entries: readonly EntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.kind !== "msa.system")
    .map((entry) => {
      const message = entry.model?.[0];
      const text = message?.role === "toolResult" ? undefined : textOf(message);
      return text === undefined ? entry.kind : `${entry.kind}:${text}`;
    });
}

const inbox = Effect.fn("inbox")(function* (harness: Harness, root: Conversation) {
  return (yield* awaited(harness.snapshot(InboxDoc, root.id, context)))!.items.map((item) => [
    item.id,
    item.mode,
  ]);
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

const harnessInboxSupport = {
  HOLD,
  answer,
  directories,
  gated,
  holdTool,
  inbox,
  queuedNote,
  status,
  toolRunning,
  transcript,
};

export default harnessInboxSupport;
