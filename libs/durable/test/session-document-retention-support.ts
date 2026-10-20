import { type ConversationId, defineDoc } from "@msa/durable";
import { Effect } from "effect";

import { environmentVariable } from "../src/env/node-process.ts";
import { SessionImpl } from "../src/session/session.ts";
import effectSupport from "./effect-support.ts";
import type sessionDocumentRetentionSupportTypes from "./session-document-retention-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { ControlledStorage, context } = sessionSupport;

const CounterDoc = defineDoc<sessionDocumentRetentionSupportTypes.Counter>({
  fork: "initial",
  history: "latest",
  initial: () => ({ count: 0 }),
  kind: "test.retention.counter",
  scope: "conversation",
  version: 1,
});

const forcedRetention = environmentVariable("MSA_DURABLE_DOCUMENT_RETENTION_MS", true);

const defaultForRun = forcedRetention === undefined ? 600_000 : Number(forcedRetention);

function open(retentionMs: number) {
  const clock = { now: 1_000 };
  const storage = new ControlledStorage();
  const session = new SessionImpl(
    storage,
    () => clock.now,
    () => retentionMs,
  );
  const sizes = () => session.documentCacheSizes;
  return { clock, session, sizes, storage };
}

const settleLine = Effect.fn("settleLine")(function* (session: SessionImpl) {
  yield* awaited(session.readOnLine(() => Promise.resolve()));
});

const bump = Effect.fn("bump")(function* (
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

const sessionDocumentRetentionSupport = {
  CounterDoc,
  bump,
  defaultForRun,
  open,
  settleLine,
};

export default sessionDocumentRetentionSupport;
