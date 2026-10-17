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
import { expect } from "vite-plus/test";

import { context } from "./session-support.ts";

export type Frame = { value: ConversationView; ops: readonly Op[] };

// Start a watch of `conversation` that records its acquisition revision and every delivered frame.
export async function record(conversation: Conversation) {
  const watch = await conversation.watch(context);
  const initial = watch.value;
  const frames: Frame[] = [];
  watch.start((value, ops) => {
    frames.push({ value, ops });

    return Promise.resolve();
  });
  return { initial, frames, stop: () => watch.stop() };
}

// A freshly built view of `conversation`, for comparing with an advanced one.
export async function fresh(conversation: Conversation): Promise<ConversationView> {
  const state = await conversation.viewState(context);
  const value = state.value;
  state.dispose();
  return value;
}

// The view as committed state defines it, read without any mount: the active entries and the built-in documents.
export async function committed(
  harness: Harness,
  conversation: Conversation,
  record: ConversationView["conversation"],
) {
  const docs: Record<string, unknown> = {};
  for await (const token of [AgentDoc, LiveDoc, InboxDoc, ProviderDoc, UsageDoc] as const) {
    const value = await harness.snapshot(token as typeof LiveDoc, conversation.id, context);
    if (value !== undefined) docs[token.definition.kind] = value;
  }
  return { conversation: record, entries: (await conversation.context(context)).entries, docs };
}

// Replay every frame's operations from `initial`, checking each delivered revision on the way.
export function replay(initial: ConversationView, frames: readonly Frame[]): ConversationView {
  let value = initial;
  for (const frame of frames) {
    value = applyImmutable(value, frame.ops);
    expect(value).toEqual(frame.value);
  }
  return value;
}

/** Let watch callbacks, which run after the commit, catch up. */
export async function drained(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
