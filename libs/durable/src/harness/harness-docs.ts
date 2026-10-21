import { Effect, Function } from "effect";

import type transactionTypes from "../session/transaction.types.ts";
import types from "../types.ts";
import agentModule from "./agent.ts";
import type harnessHostTypes from "./harness-host.ts";
import inboxModule from "./inbox.ts";
import liveModule from "./live.ts";
import provider from "./provider.ts";
import type typesModule from "./types.types.ts";
import usageModule from "./usage.ts";

const { ROOT_CONVERSATION_ID } = types;
const { configure, createAgent } = agentModule;
const { LiveDoc } = liveModule;
const { InboxDoc } = inboxModule;
const { UsageDoc } = usageModule;
const { ProviderDoc } = provider;

const createRecord = (
  tx: transactionTypes.Transaction,
  target: harnessHostTypes.CreateTarget,
): Effect.Effect<typesModule.ConversationRecord> =>
  Effect.promise(() => {
    if (target.kind === "root") return tx.createRootConversation();
    if (target.kind === "fork")
      return tx.forkConversation(target.parentId, target.at, { ownership: target.ownership });
    return tx.createConversation({ ownership: target.ownership });
  });

const createConversation: {
  (
    target: harnessHostTypes.CreateTarget,
    options: harnessHostTypes.CreateOptions,
  ): (tx: transactionTypes.Transaction) => Effect.Effect<typesModule.ConversationId>;
  (
    tx: transactionTypes.Transaction,
    target: harnessHostTypes.CreateTarget,
    options: harnessHostTypes.CreateOptions,
  ): Effect.Effect<typesModule.ConversationId>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: transactionTypes.Transaction,
    target: harnessHostTypes.CreateTarget,
    options: harnessHostTypes.CreateOptions,
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

const initializeConversation: {
  (
    record: typesModule.ConversationRecord,
    hook:
      | ((tx: transactionTypes.Transaction, record: typesModule.ConversationRecord) => unknown)
      | undefined,
  ): (tx: transactionTypes.Transaction) => Effect.Effect<void>;
  (
    tx: transactionTypes.Transaction,
    record: typesModule.ConversationRecord,
    hook:
      | ((tx: transactionTypes.Transaction, record: typesModule.ConversationRecord) => unknown)
      | undefined,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    tx: transactionTypes.Transaction,
    record: typesModule.ConversationRecord,
    hook:
      | ((tx: transactionTypes.Transaction, record: typesModule.ConversationRecord) => unknown)
      | undefined,
  ) {
    yield* Effect.promise(() => tx.doc(LiveDoc, record.id));
    yield* Effect.promise(() => tx.doc(InboxDoc, record.id));
    yield* Effect.promise(() => tx.doc(UsageDoc, record.id));
    yield* Effect.promise(() => tx.doc(ProviderDoc, record.id));
    yield* createAgent(tx, record);
    if (hook !== undefined) yield* Effect.promise(() => Promise.resolve(hook(tx, record)));
  }),
);

const harnessDocs = {
  createConversation,
  initializeConversation,
};

export default harnessDocs;
