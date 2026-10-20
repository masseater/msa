import { applyImmutable } from "@msa/chord/delta";
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

import effectSupport from "./effect-support.ts";
import type harnessViewSupportTypes from "./harness-view-support.types.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context } = sessionSupport;

function record(conversation: Conversation) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const watch = yield* awaited(conversation.watch(context));
      const initial = watch.value;
      const frames: harnessViewSupportTypes.Frame[] = [];
      watch.start((value, ops) => {
        frames.push({ ops, value });

        return Promise.resolve();
      });
      return { frames, initial, stop: () => watch.stop() };
    }),
  );
}

const fresh = Effect.fn("fresh")(function* (conversation: Conversation) {
  const state = yield* awaited(conversation.viewState(context));
  const value = state.value;
  state.dispose();
  return value;
});

const committed = Effect.fn("committed")(function* (
  harness: Harness,
  conversation: Conversation,
  recordInner: ConversationView["conversation"],
) {
  const docs: Record<string, unknown> = {};
  for (const token of [AgentDoc, LiveDoc, InboxDoc, ProviderDoc, UsageDoc] as const) {
    const value = yield* awaited(
      harness.snapshot(token as typeof LiveDoc, conversation.id, context),
    );
    if (value !== undefined) docs[token.definition.kind] = value;
  }
  return {
    conversation: recordInner,
    docs,
    entries: (yield* awaited(conversation.context(context))).entries,
  };
});

function replayImpl(
  initial: ConversationView,
  frames: readonly harnessViewSupportTypes.Frame[],
): ConversationView {
  let value = initial;
  for (const frame of frames) {
    value = applyImmutable(value, frame.ops);
    expect(value).toEqual(frame.value);
  }
  return value;
}

const replay: {
  (
    frames: readonly harnessViewSupportTypes.Frame[],
  ): (initial: ConversationView) => ReturnType<typeof replayImpl>;
  (
    initial: ConversationView,
    frames: readonly harnessViewSupportTypes.Frame[],
  ): ReturnType<typeof replayImpl>;
} = dual(2, replayImpl);

const drained = Effect.fn("drained")(function* () {
  yield* Effect.sleep(1);
});

const harnessViewSupport = {
  committed,
  drained,
  fresh,
  record,
  replay,
};

export default harnessViewSupport;
