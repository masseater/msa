import type aiTypes from "@msa/ai/index.types";
import json from "@msa/chord/json";
import { Effect, Function } from "effect";

import entries from "../entries.ts";
import type generationTypesModule from "./generation-types.types.ts";
import generationModule from "./generation.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { copyJson } = json;

const { recordUsage } = usageModule;
const { AssistantEntry } = entries;
const appendAssistant: typesModule.Dual3<
  typesModule.Tx,
  typesModule.ConversationId,
  aiTypes.AssistantMessage,
  Effect.Effect<typesModule.TypedEntry<never>>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    message: aiTypes.AssistantMessage,
  ) {
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

const convertPartial: typesModule.Dual3<
  typesModule.Tx,
  liveTypes.LiveDraft,
  typesModule.ConversationId,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    live: liveTypes.LiveDraft,
    conversationId: typesModule.ConversationId,
  ) {
    const partial = live.generation?.message;
    if (partial === undefined) return;
    const message = copyJson(partial) as unknown as aiTypes.AssistantMessage;
    yield* appendAssistant(tx, conversationId, { ...message, stopReason: "aborted" });
  }),
);

const createGeneration: typesModule.Dual2<
  typesModule.Tx,
  typesModule.ConversationId,
  Effect.Effect<typesModule.TaskId<generationTypesModule.GenerationResult>>
> = Function.dual(2, (tx: typesModule.Tx, conversationId: typesModule.ConversationId) =>
  Effect.promise(() =>
    tx.createTask(
      generationModule.GenerationTask,
      {},
      { conversationId, ownership: { kind: "conversation" } },
    ),
  ),
);

const startRun: typesModule.Dual4<
  typesModule.Tx,
  typesModule.ConversationId,
  liveTypes.LiveDraft,
  typesModule.SubmissionId[],
  Effect.Effect<void>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    tx: typesModule.Tx,
    conversationId: typesModule.ConversationId,
    live: liveTypes.LiveDraft,
    inputs: typesModule.SubmissionId[],
  ) {
    live.run = { inputs, taskId: yield* createGeneration(tx, conversationId) };
  }),
);

const handOver: typesModule.Dual3<
  liveTypes.LiveDraft,
  typesModule.TaskId,
  typesModule.TaskId,
  void
> = Function.dual(
  3,
  (live: liveTypes.LiveDraft, from: typesModule.TaskId, to: typesModule.TaskId): void => {
    if (live.run?.taskId === from) live.run.taskId = to;
  },
);

const generationRun = {
  appendAssistant,
  convertPartial,
  createGeneration,
  handOver,
  startRun,
};

export default generationRun;
