import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type chatSupportTypes from "./chat-support.types.ts";
import testSupport from "./support.ts";

const { Type, fauxAssistantMessage, fauxText, fauxToolCall } = ai;

const { InboxDoc, LiveDoc, defineTool } = durable;

const { textOf, waitFor } = testSupport;
const { awaited } = testSupport;
const { addTool } = testSupport;
const { context } = testSupport;
const { aborted, deferred } = testSupport;

const directories = new Set<string>();

function answer(text: string): aiTypes.AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

function gated(message: aiTypes.AssistantMessage): {
  step: aiTypes.FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gate = deferred();
  const step: aiTypes.FauxResponseStep = (_request, options) =>
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
  result: durableTypes.ToolExecutionResult = { output: [] },
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
    result?: durableTypes.ToolExecutionResult,
  ): (setup: chatSupportTypes.ChatSetup) => ReturnType<typeof holdToolImpl>;
  (
    setup: chatSupportTypes.ChatSetup,
    gate: PromiseWithResolvers<void>,
    result?: durableTypes.ToolExecutionResult,
  ): ReturnType<typeof holdToolImpl>;
} = dual((args) => "registry" in args[0], holdToolImpl);

function queuedNote(text: string) {
  return { kind: "note", model: [{ content: text, role: "user", timestamp: 0 }] } as const;
}

const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

function status(submission: durableTypes.Submission): Promise<durableTypes.SubmissionRecord> {
  return Promise.resolve(submission.status(context));
}

function transcript(entries: readonly durableTypes.EntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.kind !== "msa.system")
    .map((entry) => {
      const message = entry.model?.[0];
      const text = message?.role === "toolResult" ? undefined : textOf(message);
      return text === undefined ? entry.kind : `${entry.kind}:${text}`;
    });
}

const inbox = Effect.fn("inbox")(function* (
  harness: durableTypes.Harness,
  root: durableTypes.Conversation,
) {
  return (yield* awaited(harness.snapshot(InboxDoc, root.id, context)))!.items.map((item) => [
    item.id,
    item.mode,
  ]);
});

const toolRunning = Effect.fn("toolRunning")(function* (
  harness: durableTypes.Harness,
  root: durableTypes.Conversation,
) {
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
