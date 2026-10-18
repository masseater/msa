import { applyImmutable, type Op } from "@msa/chord/delta";
import {
  AgentDoc,
  type Conversation,
  type ConversationView,
  type Harness,
  InboxDoc,
  LiveDoc,
  ProviderDoc,
  UsageDoc,
} from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";
import { expect } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export type Frame = { value: ConversationView; ops: readonly Op[] };

export function record(conversation: Conversation) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const watch = yield* awaited(conversation.watch(context));
      const initial = watch.value;
      const frames: Frame[] = [];
      watch.start((value, ops) => {
        frames.push({ value, ops });

        return Promise.resolve();
      });
      return { initial, frames, stop: () => watch.stop() };
    }),
  );
}

export const fresh = Effect.fn("fresh")(function* (conversation: Conversation) {
  const state = yield* awaited(conversation.viewState(context));
  const value = state.value;
  state.dispose();
  return value;
});

export const committed = Effect.fn("committed")(function* (
  harness: Harness,
  conversation: Conversation,
  record: ConversationView["conversation"],
) {
  const docs: Record<string, unknown> = {};
  for (const token of [AgentDoc, LiveDoc, InboxDoc, ProviderDoc, UsageDoc] as const) {
    const value = yield* awaited(
      harness.snapshot(token as typeof LiveDoc, conversation.id, context),
    );
    if (value !== undefined) docs[token.definition.kind] = value;
  }
  return {
    conversation: record,
    entries: (yield* awaited(conversation.context(context))).entries,
    docs,
  };
});

function replayImpl(initial: ConversationView, frames: readonly Frame[]): ConversationView {
  let value = initial;
  for (const frame of frames) {
    value = applyImmutable(value, frame.ops);
    expect(value).toEqual(frame.value);
  }
  return value;
}

export const replay: {
  (frames: readonly Frame[]): (initial: ConversationView) => ReturnType<typeof replayImpl>;
  (initial: ConversationView, frames: readonly Frame[]): ReturnType<typeof replayImpl>;
} = dual(2, replayImpl);

export const drained = Effect.fn("drained")(function* () {
  yield* Effect.sleep(1);
});
