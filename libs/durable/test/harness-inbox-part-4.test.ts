import type { Op } from "@msa/chord/delta";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessInboxSupport from "./harness-inbox-support.ts";
import support from "./support.ts";

const { MemoryStorage } = memory;
const { LiveDoc } = durable;

const { answer, directories, gated, inbox, status } = harnessInboxSupport;
const { awaited, chatSetup, context, documentChanges, openChat, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const leavesInboxAlone = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("never"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  const taskId = (yield* awaited(harness.snapshot(LiveDoc, root.id, context)))!.run!.taskId;
  yield* awaited(harness.abortTask(taskId, context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  yield* awaited(harness.waitForIdle(context));
  expect((yield* awaited(status(f))).status).toBe("queued");
  expect(yield* inbox(harness, root)).toEqual([[f.id, "followUp"]]);
  yield* awaited(harness.close(context));
});

const returnsQueuedSubmission = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const queued = yield* awaited(
    root.submit({ content: "f", requestId: "r", type: "input" }, context),
  );
  const again = yield* awaited(
    root.submit({ content: "f", requestId: "r", type: "input" }, context),
  );
  expect(again.id).toBe(queued.id);
  expect(yield* inbox(harness, root)).toEqual([[queued.id, "followUp"]]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("leaves the inbox alone when the run's task is aborted", () =>
    Effect.runPromise(leavesInboxAlone));

  it("returns a queued submission for its repeated request ID without a second item", () =>
    Effect.runPromise(returnsQueuedSubmission));
});

const withdrawsMiddleItem = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const items = [];
  for (const text of ["x", "y", "z"])
    items.push(yield* awaited(root.submit({ content: text, type: "input" }, context)));
  const ops: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.inbox" && change.ops.length > 0) ops.push([...change.ops]);
    }
  });
  yield* awaited(items[1]!.abort(context));
  expect(ops).toEqual([[["p", ["items"], 1, 1, []]]]);
  expect(yield* inbox(harness, root)).toEqual([
    [items[0]!.id, "followUp"],
    [items[2]!.id, "followUp"],
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("withdraws a middle item with one positional removal", () =>
    Effect.runPromise(withdrawsMiddleItem));
});
