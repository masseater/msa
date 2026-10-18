import { fauxAssistantMessage } from "@msa/ai";
import type { Op } from "@msa/chord/delta";
import { LiveDoc } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { toJsonText, awaited } from "./effect-support.ts";
import {
  HOLD,
  holdTool,
  transcript,
  inbox,
  status,
  queuedNote,
  answer,
  gated,
} from "./harness-inbox-support.ts";
import { addHooks } from "./harness-support.ts";
import { context, documentChanges } from "./session-support.ts";
import { deferred } from "./task-support.ts";

const makesHeadWrite = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const target = (yield* allEntries(root))[0]!;
  yield* awaited(root.reset(undefined, context));
  const summary = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: target.id } }, context),
  );
  first.release();
  yield* awaited(input.wait(context));
  expect(yield* awaited(status(summary))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  yield* awaited(harness.close(context));
});

const endsRunMsa = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  gate.resolve();
  holdTool(setup, gate, { output: [], control: { handoff: "continue here" } });
  setup.faux.setResponses([HOLD]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "a" }, context))).wait(context),
  );
  const entries = yield* allEntries(root);
  const calling = entries.find((entry) => entry.kind === "msa.assistant")!;
  expect(settled).toMatchObject({ status: "done", answer: calling.id });
  expect(transcript(entries)).toEqual([
    "msa.user:a",
    "msa.assistant",
    "msa.tool-result",
    "msa.reset:continue here",
  ]);
  expect(entries.at(-1)!.head).toBe(entries.at(-1)!.id);
  expect(setup.faux.state.callCount).toBe(1);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("makes a head write stale behind a reset placed earlier in the same boundary", () =>
    Effect.runPromise(makesHeadWrite));

  it("ends the run with a msa.reset entry when a tool requests a handoff", () =>
    Effect.runPromise(endsRunMsa));
});

const dropsOnYieldContinuation = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  let yields = 0;
  addHooks(setup.registry, GenerationTask, {
    onYield: () => (yields++ === 0 ? { continue: "more" } : undefined),
  });
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const followUp = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  first.release();
  yield* awaited(followUp.wait(context));
  expect(yield* awaited(status(input))).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "msa.user:f",
    "msa.assistant:second",
  ]);
  yield* awaited(harness.close(context));
});

const withdrawsQueuedSubmission = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const kept = yield* awaited(root.submit({ type: "write", entry: queuedNote("kept") }, context));
  const withdrawn = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  expect(yield* awaited(withdrawn.abort(context))).toBe("aborted");
  expect(yield* awaited(withdrawn.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(yield* inbox(harness, root)).toEqual([[kept.id, "write"]]);
  first.release();
  yield* awaited(input.wait(context));
  expect(yield* awaited(status(kept))).toMatchObject({ status: "done" });
  expect(setup.faux.state.callCount).toBe(1);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("drops an onYield continuation when the final boundary selects a follow-up", () =>
    Effect.runPromise(dropsOnYieldContinuation));

  it("withdraws a queued submission and removes its item", () =>
    Effect.runPromise(withdrawsQueuedSubmission));
});

const leavesQueuedItems = Effect.gen(function* () {
  const setup = chatSetup();
  const failing = gated(
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
  );
  setup.faux.setResponses([failing.step, answer("for f"), answer("for g")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  failing.release();
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
  });
  yield* awaited(harness.waitForIdle(context));
  expect((yield* awaited(status(f))).status).toBe("queued");
  expect(yield* inbox(harness, root)).toEqual([[f.id, "followUp"]]);

  const g = yield* awaited(
    root.submit({ type: "input", content: "g", whenBusy: "reject" }, context),
  );
  yield* awaited(g.wait(context));
  expect(yield* awaited(status(f))).toMatchObject({ status: "done" });
  expect(transcript(yield* allEntries(root)).slice(-4)).toEqual([
    "msa.user:f",
    "msa.assistant:for f",
    "msa.user:g",
    "msa.assistant:for g",
  ]);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("leaves queued items after a failed run until the next submission places them in order", () =>
    Effect.runPromise(leavesQueuedItems));
});

const commitsInboxChanges = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const ops: Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.inbox" && change.ops.length > 0) ops.push([...change.ops]);
    }
  });
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const w1 = yield* awaited(root.submit({ type: "write", entry: queuedNote("w") }, context));
  const f1 = yield* awaited(root.submit({ type: "input", content: "f1" }, context));
  const w2 = yield* awaited(root.submit({ type: "write", entry: queuedNote("w") }, context));
  const f2 = yield* awaited(root.submit({ type: "input", content: "f2" }, context));
  const w3 = yield* awaited(root.submit({ type: "write", entry: queuedNote("w") }, context));
  expect(ops).toEqual([
    [["p", ["items"], 0, 0, [{ id: w1.id, mode: "write", entry: queuedNote("w") }]]],
    [["p", ["items"], 1, 0, [{ id: f1.id, mode: "followUp", content: "f1" }]]],
    [["p", ["items"], 2, 0, [{ id: w2.id, mode: "write", entry: queuedNote("w") }]]],
    [["p", ["items"], 3, 0, [{ id: f2.id, mode: "followUp", content: "f2" }]]],
    [["p", ["items"], 4, 0, [{ id: w3.id, mode: "write", entry: queuedNote("w") }]]],
  ]);
  first.release();
  yield* awaited(input.wait(context));
  expect(ops[5]!.every((op) => op[0] === "p" && (op[4] as unknown[]).length === 0)).toBe(true);
  expect(ops[5]).toContainEqual(["p", ["items"], 4, 1, []]);
  expect(yield* toJsonText(ops[5])).not.toContain("f2");
  yield* awaited(f2.wait(context));
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("commits inbox changes as positional Chord operations and a base when empty", () =>
    Effect.runPromise(commitsInboxChanges));
});

const settlesStaleWrite = Effect.gen(function* () {
  const setup = chatSetup();
  const failing = gated(
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request" }),
  );
  setup.faux.setResponses([failing.step, answer("for f")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const old = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  yield* awaited(root.reset(undefined, context));
  const before = (yield* allEntries(root)).length;
  const idle = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: old.id } }, context),
  );
  expect(yield* awaited(idle.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect(yield* allEntries(root)).toHaveLength(before);

  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  failing.release();
  yield* awaited(input.wait(context));
  yield* awaited(harness.waitForIdle(context));
  const queued = yield* awaited(
    root.submit({ type: "write", entry: { kind: "summary", head: old.id } }, context),
  );
  expect(yield* awaited(queued.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect(yield* awaited(f.wait(context))).toMatchObject({ status: "done" });
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("settles a stale write at once while idle, and a queued one behind waiting items", () =>
    Effect.runPromise(settlesStaleWrite));
});
