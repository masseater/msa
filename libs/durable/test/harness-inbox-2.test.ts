import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { directories, transcript, inbox, status, answer, gated } from "./harness-inbox-support.ts";
import { allEntries, chatSetup, openChat, awaited, removeDir, context } from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const placesQueuedReset = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  yield* awaited(root.reset("handoff", context));
  first.release();
  yield* awaited(input.wait(context));
  yield* awaited(harness.waitForIdle(context));
  expect(yield* awaited(status(input))).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "msa.reset:handoff",
  ]);
  expect((yield* awaited(root.context(context))).messages).toEqual([
    { role: "user", content: "handoff", timestamp: expect.any(Number) },
  ]);
  yield* awaited(harness.close(context));
});

const resetsIdleConversation = Effect.gen(function* () {
  const setup = chatSetup();
  setup.now = () => 7;
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context));
  yield* awaited(root.reset(undefined, context));
  let view = yield* awaited(root.context(context));
  expect(view.head?.kind).toBe("msa.reset");
  expect(view.head?.model).toBeUndefined();
  expect(view.messages).toEqual([]);
  yield* awaited(root.reset("carry on", context));
  view = yield* awaited(root.context(context));
  expect(view.head?.head).toBe(view.head?.id);
  expect(view.messages).toEqual([{ role: "user", content: "carry on", timestamp: 7 }]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("places a queued reset after the answer at the final boundary", () =>
    Effect.runPromise(placesQueuedReset));

  it("resets an idle conversation at once, with or without handoff text", () =>
    Effect.runPromise(resetsIdleConversation));
});

const makesQueuedHead = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const old = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  yield* awaited(root.reset(undefined, context));
  const reset = (yield* awaited(root.context(context))).head!;
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const stale = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: old.id } }, context),
  );
  const fresh = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: reset.id } }, context),
  );
  first.release();
  yield* awaited(input.wait(context));
  expect(yield* awaited(status(stale))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect(yield* awaited(status(fresh))).toMatchObject({ status: "done" });
  expect(yield* inbox(harness, root)).toEqual([]);

  const inside = (yield* allEntries(root)).find((entry) => entry.kind === "msa.user")!;
  const second = yield* awaited(root.submit({ type: "input", content: "b" }, context));
  const kept = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: inside.id } }, context),
  );
  yield* awaited(second.wait(context));
  expect(yield* awaited(status(kept))).toMatchObject({ status: "done" });
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("makes a queued head write stale when it targets an entry before the active range", () =>
    Effect.runPromise(makesQueuedHead));
});
