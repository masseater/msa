import { defineDoc, defineDocFamily } from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { context, createConversation, openTestSession } from "./session-support.ts";

export type Live = {
  message?: string;
  items: string[];
  nested: { count: number };
  other: { label: string };
};

export let liveInitCount = 0;

export const LiveDoc = defineDoc<Live>({
  kind: "test.live",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => {
    liveInitCount++;
    return { items: [], nested: { count: 0 }, other: { label: "x" } };
  },
});

export type Counter = { count: number };

export const CounterDoc = defineDoc<Counter>({
  kind: "test.counter",
  version: 1,
  scope: "session",
  initial: () => ({ count: 0 }),
});

export type Member = { seed: string; hits: number };

export const seeds: string[] = [];

export const MemberDoc = defineDocFamily<Member, string>({
  kind: "test.member",
  version: 1,
  family: true,
  scope: "session",
  initial: (seed) => {
    seeds.push(seed);
    return { seed, hits: 0 };
  },
});

export const setupLive = Effect.fn("setupLive")(function* () {
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
