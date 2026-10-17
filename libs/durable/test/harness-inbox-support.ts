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

import { type ChatSetup, textOf, waitFor } from "./chat-support.ts";
import { addTool } from "./harness-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export const directories = new Set<string>();

export function answer(text: string): AssistantMessage {
  return fauxAssistantMessage([fauxText(text)]);
}

// A faux response held until `release` or cancellation; `reached` resolves when the request is sent.
export function gated(message: AssistantMessage): {
  step: FauxResponseStep;
  reached: Promise<void>;
  release: () => void;
} {
  const reached = deferred();
  const gate = deferred();
  const step: FauxResponseStep = async (_request, options) => {
    reached.resolve();
    await Promise.race([gate.promise, aborted(options!.signal!)]);
    return message;
  };
  return { step, reached: reached.promise, release: () => gate.resolve() };
}

// Register a `hold` tool whose calls wait for `gate` and then return `result`.
export function holdTool(
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
      execute: async () => {
        await gate.promise;
        return result;
      },
    }),
  );
}

// A write that affects model context, so it queues while busy; a data-only write would be appended at once.
export function queuedNote(text: string) {
  return { kind: "note", model: [{ role: "user", content: text, timestamp: 0 }] } as const;
}

export const HOLD = fauxAssistantMessage([fauxToolCall("hold", {}, { id: "c1" })], {
  stopReason: "toolUse",
});

export function status(submission: Submission): Promise<SubmissionRecord> {
  return Promise.resolve(submission.status(context));
}

// Kind and text of each entry, skipping system entries.
export function transcript(entries: readonly EntryRecord[]): string[] {
  return entries
    .filter((entry) => entry.kind !== "msa.system")
    .map((entry) => {
      const message = entry.model?.[0];
      const text = message?.role === "toolResult" ? undefined : textOf(message);
      return text === undefined ? entry.kind : `${entry.kind}:${text}`;
    });
}

export async function inbox(harness: Harness, root: Conversation) {
  return (await harness.snapshot(InboxDoc, root.id, context))!.items.map((item) => [
    item.id,
    item.mode,
  ]);
}

export async function toolRunning(harness: Harness, root: Conversation): Promise<void> {
  await waitFor(
    async () =>
      (await harness.snapshot(LiveDoc, root.id, context))?.tools?.[0]?.status === "running",
  );
}
