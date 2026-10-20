import { LiveDoc, defineDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import chatSupport from "./chat-support.ts";
import effectSupport from "./effect-support.ts";
import harnessViewSupport from "./harness-view-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { chatSetup, openChat } = chatSupport;
const { abortController, awaited } = effectSupport;
const { committed, drained, record, replay } = harnessViewSupport;
const { context } = sessionSupport;
const { deferred } = taskSupport;

const rejectsAcquisitionCancelled = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const hold = () => {
    const release = deferred();
    const blocking = root.commit(
      () => runPromise(Effect.asVoid(Effect.suspend(() => awaited(release.promise)))),
      context,
    );
    return { blocking, release: () => release.resolve() };
  };
  let held = hold();
  const controller = abortController();
  const cancelled = root.watch({ ...context, abortSignal: controller.signal });
  controller.abort(new Error("cancelled"));
  held.release();
  yield* awaited(held.blocking);
  yield* awaited(expect(cancelled).rejects.toThrow("cancelled"));

  held = hold();
  const closedWhileQueued = root.watch(context);
  const closing = harness.close(context);
  held.release();
  yield* awaited(held.blocking);
  yield* awaited(expect(closedWhileQueued).rejects.toThrow("Harness is closed"));
  yield* awaited(closing);
});

const sharesOneMount = Effect.gen(function* () {
  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const failing = yield* awaited(root.watch(context));
  const { frames, stop } = yield* awaited(record(root));
  const shared = yield* awaited(root.viewState(context));
  expect(failing.value).toBe(shared.value);
  shared.dispose();
  failing.start(() => Promise.reject(new Error("listener failed")));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "one" }), context));
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "two" }), context));
  yield* drained();
  expect(yield* awaited(failing.closed)).toMatchObject({ reason: "listener_error" });
  expect(frames).toHaveLength(2);
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("rejects an acquisition cancelled or closed while it waits for the Session line", () =>
    Effect.runPromise(rejectsAcquisitionCancelled));

  it("shares one mount between concurrent observers and isolates a failing listener", () =>
    Effect.runPromise(sharesOneMount));
});

const publishesOneFrame = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openChat(new MemoryStorage(), chatSetup());
  const Other = defineDoc<{ n: number }>({
    fork: "initial",
    history: "latest",
    initial: () => ({ n: 0 }),
    kind: "app.other",
    scope: "conversation",
    version: 1,
  });
  const { initial, frames, stop } = yield* awaited(record(root));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.appendEntry(root.id, { kind: "a" }));
            (yield* awaited(tx.doc(LiveDoc, root.id))).tools = [];
            yield* awaited(tx.appendEntry(root.id, { kind: "b" }));
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Other, root.id))).n = 1;
          }),
        ),
      context,
    ),
  );
  yield* drained();
  expect(frames).toHaveLength(1);
  expect(frames[0]!.value.entries.map((entry) => entry.kind)).toEqual(["a", "b"]);
  expect(replay(initial, frames)).toEqual(yield* committed(harness, root, initial.conversation));
  yield* awaited(stop());
  yield* awaited(harness.close(context));
});

describe("conversation view", () => {
  it("publishes one frame for a commit that appends several entries and edits a document", () =>
    Effect.runPromise(publishesOneFrame));
});
