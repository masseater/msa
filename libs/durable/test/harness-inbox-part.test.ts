import ai from "@msa/ai";
import type deltaTypes from "@msa/chord/delta.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessInboxSupport from "./harness-inbox-support.ts";
import support from "./support.ts";

const { fauxAssistantMessage } = ai;

const { MemoryStorage } = memory;
const { LiveDoc } = durable;
const { GenerationTask } = harnessModule;

const { HOLD, answer, gated, holdTool, inbox, queuedNote, status, transcript } =
  harnessInboxSupport;
const {
  addHooks,
  allEntries,
  awaited,
  chatSetup,
  context,
  deferred,
  documentChanges,
  openChat,
  toJsonText,
} = support;

const makesHeadWrite = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const target = (yield* allEntries(root))[0]!;
  yield* awaited(root.reset(undefined, context));
  const summary = yield* awaited(
    root.submit({ entry: { head: target.id, kind: "summary" }, type: "write" }, context),
  );
  first.release();
  yield* awaited(input.wait(context));
  expect(yield* awaited(status(summary))).toMatchObject({
    reason: "stale",
    status: "unanswered",
  });
  yield* awaited(harness.close(context));
});

const endsRunMsa = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  gate.resolve();
  holdTool(setup, gate, { control: { handoff: "continue here" }, output: [] });
  setup.faux.setResponses([HOLD]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "a", type: "input" }, context))).wait(context),
  );
  const entries = yield* allEntries(root);
  const calling = entries.find((entry) => entry.kind === "msa.assistant")!;
  expect(settled).toMatchObject({ answer: calling.id, status: "done" });
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
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const followUp = yield* awaited(root.submit({ content: "f", type: "input" }, context));
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
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const kept = yield* awaited(root.submit({ entry: queuedNote("kept"), type: "write" }, context));
  const withdrawn = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  expect(yield* awaited(withdrawn.abort(context))).toBe("aborted");
  expect(yield* awaited(withdrawn.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
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
    fauxAssistantMessage([], { errorMessage: "invalid request", stopReason: "error" }),
  );
  setup.faux.setResponses([failing.step, answer("for f"), answer("for g")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  failing.release();
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "model_error",
    status: "unanswered",
  });
  yield* awaited(harness.waitForIdle(context));
  expect((yield* awaited(status(f))).status).toBe("queued");
  expect(yield* inbox(harness, root)).toEqual([[f.id, "followUp"]]);

  const g = yield* awaited(
    root.submit({ content: "g", type: "input", whenBusy: "reject" }, context),
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
  const ops: deltaTypes.Op[][] = [];
  harness.subscribeCommits((publication) => {
    for (const change of documentChanges(publication)) {
      if (change.record.kind === "msa.inbox" && change.ops.length > 0) ops.push([...change.ops]);
    }
  });
  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(first.reached);
  const w1 = yield* awaited(root.submit({ entry: queuedNote("w"), type: "write" }, context));
  const f1 = yield* awaited(root.submit({ content: "f1", type: "input" }, context));
  const w2 = yield* awaited(root.submit({ entry: queuedNote("w"), type: "write" }, context));
  const f2 = yield* awaited(root.submit({ content: "f2", type: "input" }, context));
  const w3 = yield* awaited(root.submit({ entry: queuedNote("w"), type: "write" }, context));
  expect(ops).toEqual([
    [["p", ["items"], 0, 0, [{ entry: queuedNote("w"), id: w1.id, mode: "write" }]]],
    [["p", ["items"], 1, 0, [{ content: "f1", id: f1.id, mode: "followUp" }]]],
    [["p", ["items"], 2, 0, [{ entry: queuedNote("w"), id: w2.id, mode: "write" }]]],
    [["p", ["items"], 3, 0, [{ content: "f2", id: f2.id, mode: "followUp" }]]],
    [["p", ["items"], 4, 0, [{ entry: queuedNote("w"), id: w3.id, mode: "write" }]]],
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
    fauxAssistantMessage([], { errorMessage: "invalid request", stopReason: "error" }),
  );
  setup.faux.setResponses([failing.step, answer("for f")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const old = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  yield* awaited(root.reset(undefined, context));
  const before = (yield* allEntries(root)).length;
  const idle = yield* awaited(
    root.submit({ entry: { head: old.id, kind: "summary" }, type: "write" }, context),
  );
  expect(yield* awaited(idle.wait(context))).toMatchObject({
    reason: "stale",
    status: "unanswered",
  });
  expect(yield* allEntries(root)).toHaveLength(before);

  const input = yield* awaited(root.submit({ content: "a", type: "input" }, context));
  yield* awaited(failing.reached);
  const f = yield* awaited(root.submit({ content: "f", type: "input" }, context));
  failing.release();
  yield* awaited(input.wait(context));
  yield* awaited(harness.waitForIdle(context));
  const queued = yield* awaited(
    root.submit({ entry: { head: old.id, kind: "summary" }, type: "write" }, context),
  );
  expect(yield* awaited(queued.wait(context))).toMatchObject({
    reason: "stale",
    status: "unanswered",
  });
  expect(yield* awaited(f.wait(context))).toMatchObject({ status: "done" });
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("settles a stale write at once while idle, and a queued one behind waiting items", () =>
    Effect.runPromise(settlesStaleWrite));
});
