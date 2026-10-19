import { LiveDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { type Frame, drained, record, fresh } from "./harness-view-support.ts";
import { context } from "./session-support.ts";

const unmountsRetiredDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const { frames, stop } = yield* awaited(record(root));
  yield* awaited(root.commit((tx) => tx.retireDoc(LiveDoc, root.id), context));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).tools = [];
          }),
        ),
      context,
    ),
  );
  yield* drained();
  expect(frames.map((frame) => frame.ops)).toEqual([
    [["d", ["docs", "msa.live"]]],
    [["s", ["docs", "msa.live"], { tools: [] }]],
  ]);
  expect(frames[0]!.value.docs["msa.live"]).toBeUndefined();
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

const replacesUndeliveredFrames = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const watch = yield* awaited(root.watch(context));
  for (const _ of Array.from({ length: 101 })) {
    yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  }
  const frames: Frame[] = [];
  watch.start((value, ops) => {
    frames.push({ value, ops });

    return Promise.resolve();
  });
  yield* drained();
  expect(frames).toHaveLength(1);
  expect(frames[0]!.ops).toEqual([["r", frames[0]!.value]]);
  expect(frames[0]!.value.entries).toHaveLength(101);
  yield* awaited(watch.stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("unmounts a retired document and mounts its recreation whole", () =>
    Effect.runPromise(unmountsRetiredDocument));

  it("replaces undelivered frames with the newest view after 100 pending frames", () =>
    Effect.runPromise(replacesUndeliveredFrames));
});

const keepsStatesWatches = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const state = yield* awaited(root.viewState(context));
  const { frames, stop } = yield* awaited(record(root));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "one" }), context));
  yield* drained();
  expect(state.value.entries.map((entry) => entry.kind)).toEqual(["one"]);
  yield* awaited(stop());
  expect(frames).toHaveLength(1);
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "two" }), context));
  yield* drained();
  expect(state.value.entries.map((entry) => entry.kind)).toEqual(["one", "two"]);
  const last = state.value;
  state.dispose();
  const rebuilt = yield* fresh(root);
  expect(rebuilt).toEqual(last);
  expect(rebuilt).not.toBe(last);
  yield* awaited(harness.close(context));
});

const endsStatesWatches = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const watch = yield* awaited(root.watch(context));
  const state = yield* awaited(root.viewState(context));
  yield* awaited(harness.close(context));
  expect(yield* awaited(watch.closed)).toEqual({ reason: "session_closed" });
  expect(state.value.entries).toEqual([]);
  yield* awaited(expect(root.watch(context)).rejects.toThrow());
  yield* awaited(expect(root.viewState(context)).rejects.toThrow());
});

describe("conversation view", () => {
  it("keeps states and watches of one conversation independent and remounts after the last one detaches", () =>
    Effect.runPromise(keepsStatesWatches));

  it("ends states and watches at close and rejects later acquisition", () =>
    Effect.runPromise(endsStatesWatches));
});
