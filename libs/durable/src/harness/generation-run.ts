import type { AssistantMessage } from "@msa/ai";
import { copyJson, type Draft } from "@msa/chord";
import { Effect, Function } from "effect";

import { AssistantEntry } from "../entries.ts";
import type { GenerationResult } from "./generation-types.ts";
import { GenerationTask } from "./generation.ts";
import type { LiveState } from "./live.ts";
import type {
  ConversationId,
  Dual2,
  Dual3,
  Dual4,
  SubmissionId,
  TaskId,
  Tx,
  TypedEntry,
} from "./types.ts";
import { recordUsage } from "./usage.ts";

export const appendAssistant: Dual3<
  Tx,
  ConversationId,
  AssistantMessage,
  Effect.Effect<TypedEntry<never>>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (tx: Tx, conversationId: ConversationId, message: AssistantMessage) {
    yield* recordUsage(
      tx,
      conversationId,
      "models",
      `${message.provider}/${message.model}`,
      message.usage,
    );
    return yield* Effect.promise(() =>
      tx.appendEntry(AssistantEntry, conversationId, { model: [message] }),
    );
  }),
);

export const convertPartial: Dual3<
  Tx,
  Draft<LiveState>,
  ConversationId,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (tx: Tx, live: Draft<LiveState>, conversationId: ConversationId) {
    const partial = live.generation?.message;
    if (partial === undefined) return;
    const message = copyJson(partial) as unknown as AssistantMessage;
    yield* appendAssistant(tx, conversationId, { ...message, stopReason: "aborted" });
  }),
);

export const createGeneration: Dual2<
  Tx,
  ConversationId,
  Effect.Effect<TaskId<GenerationResult>>
> = Function.dual(2, (tx: Tx, conversationId: ConversationId) =>
  Effect.promise(() =>
    tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" }, conversationId }),
  ),
);

export const startRun: Dual4<
  Tx,
  ConversationId,
  Draft<LiveState>,
  SubmissionId[],
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    tx: Tx,
    conversationId: ConversationId,
    live: Draft<LiveState>,
    inputs: SubmissionId[],
  ) {
    live.run = { taskId: yield* createGeneration(tx, conversationId), inputs };
  }),
);

export const handOver: Dual3<Draft<LiveState>, TaskId, TaskId, void> = Function.dual(
  3,
  (live: Draft<LiveState>, from: TaskId, to: TaskId): void => {
    if (live.run?.taskId === from) live.run.taskId = to;
  },
);
