import { type ConversationId, defineDoc } from "@msa/durable";
import { Effect } from "effect";

import { environmentVariable } from "../src/env/node-process.ts";
import { SessionImpl } from "../src/session/session.ts";
import { awaited } from "./effect-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

export type Counter = { count: number };

export const CounterDoc = defineDoc<Counter>({
  kind: "test.retention.counter",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ count: 0 }),
});

const forcedRetention = environmentVariable("MSA_DURABLE_DOCUMENT_RETENTION_MS", true);

export const defaultForRun = forcedRetention === undefined ? 600_000 : Number(forcedRetention);

export function open(retentionMs: number) {
  const clock = { now: 1_000 };
  const storage = new ControlledStorage();
  const session = new SessionImpl(
    storage,
    () => clock.now,
    () => retentionMs,
  );
  const sizes = () => session.documentCacheSizes;
  return { storage, session, clock, sizes };
}

export const settleLine = Effect.fn("settleLine")(function* (session: SessionImpl) {
  yield* awaited(session.readOnLine(() => Promise.resolve()));
});

export const bump = Effect.fn("bump")(function* (
  session: SessionImpl,
  conversationId: ConversationId,
  by = 1,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(CounterDoc, conversationId))).count += by;
          }),
        ),
      context,
    ),
  );
});
