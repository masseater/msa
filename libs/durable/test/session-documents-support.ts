import { defineDoc, defineDocFamily } from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import type sessionDocumentsSupportTypes from "./session-documents-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context, createConversation, openTestSession } = sessionSupport;

const liveInits = { count: 0 };

const LiveDoc = defineDoc<sessionDocumentsSupportTypes.Live>({
  fork: "initial",
  history: "latest",
  initial: () => {
    liveInits.count++;
    return { items: [], nested: { count: 0 }, other: { label: "x" } };
  },
  kind: "test.live",
  scope: "conversation",
  version: 1,
});

const CounterDoc = defineDoc<sessionDocumentsSupportTypes.Counter>({
  initial: () => ({ count: 0 }),
  kind: "test.counter",
  scope: "session",
  version: 1,
});

const seeds: string[] = [];

const MemberDoc = defineDocFamily<sessionDocumentsSupportTypes.Member, string>({
  family: true,
  initial: (seed) => {
    seeds.push(seed);
    return { hits: 0, seed };
  },
  kind: "test.member",
  scope: "session",
  version: 1,
});

const setupLive = Effect.fn("setupLive")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const harness = openTestSession();
  const conversationId = yield* awaited(createConversation(harness.session));
  yield* awaited(
    harness.session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.items.push("a", "b");
          }),
        ),
      context,
    ),
  );
  return { ...harness, conversationId };
});

const sessionDocumentsSupport = {
  CounterDoc,
  LiveDoc,
  MemberDoc,
  liveInits,
  seeds,
  setupLive,
};

export default sessionDocumentsSupport;
