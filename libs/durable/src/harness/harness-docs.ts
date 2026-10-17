import { Effect, Function } from "effect";

import type { Transaction } from "../session/transaction.ts";
import { ROOT_CONVERSATION_ID } from "../types.ts";
import { configure, createAgent } from "./agent.ts";
import type { CreateOptions, CreateTarget } from "./harness-host.ts";
import { InboxDoc } from "./inbox.ts";
import { LiveDoc } from "./live.ts";
import { ProviderDoc } from "./provider.ts";
import type { ConversationId, ConversationRecord } from "./types.ts";
import { UsageDoc } from "./usage.ts";

const createRecord = (tx: Transaction, target: CreateTarget): Effect.Effect<ConversationRecord> =>
  Effect.promise(() => {
    if (target.kind === "root") return tx.createRootConversation();
    if (target.kind === "fork")
      return tx.forkConversation(target.parentId, target.at, { ownership: target.ownership });
    return tx.createConversation({ ownership: target.ownership });
  });

export const createConversation: {
  (
    target: CreateTarget,
    options: CreateOptions,
  ): (tx: Transaction) => Effect.Effect<ConversationId>;
  (tx: Transaction, target: CreateTarget, options: CreateOptions): Effect.Effect<ConversationId>;
} = Function.dual(
  3,
  Effect.fn("createConversation")(function* (
    tx: Transaction,
    target: CreateTarget,
    options: CreateOptions,
  ) {
    if (target.kind === "root") {
      const existing = yield* Effect.promise(() => tx.conversation(ROOT_CONVERSATION_ID));
      if (existing !== undefined) return ROOT_CONVERSATION_ID;
    }
    const record = yield* createRecord(tx, target);
    const { agent, init } = options;
    if (agent !== undefined) yield* Effect.promise(() => configure(tx, record.id, agent));
    if (init !== undefined) yield* Effect.promise(() => Promise.resolve(init(tx, record.id)));
    return record.id;
  }),
);

export const initializeConversation: {
  (
    record: ConversationRecord,
    hook: ((tx: Transaction, record: ConversationRecord) => unknown) | undefined,
  ): (tx: Transaction) => Effect.Effect<void>;
  (
    tx: Transaction,
    record: ConversationRecord,
    hook: ((tx: Transaction, record: ConversationRecord) => unknown) | undefined,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  Effect.fn("initializeConversation")(function* (
    tx: Transaction,
    record: ConversationRecord,
    hook: ((tx: Transaction, record: ConversationRecord) => unknown) | undefined,
  ) {
    yield* Effect.promise(() => tx.doc(LiveDoc, record.id));
    yield* Effect.promise(() => tx.doc(InboxDoc, record.id));
    yield* Effect.promise(() => tx.doc(UsageDoc, record.id));
    yield* Effect.promise(() => tx.doc(ProviderDoc, record.id));
    yield* createAgent(tx, record);
    if (hook !== undefined) yield* Effect.promise(() => Promise.resolve(hook(tx, record)));
  }),
);
