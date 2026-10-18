import { type FauxResponseStep } from "@msa/ai";
import { defineDoc, LiveDoc, ResetEntry } from "@msa/durable";
import { GenerationTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  directories,
  toolRunning,
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
import { removeDir } from "./platform-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const queuesBusySubmissions = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("second"), answer("third")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const f1 = yield* awaited(root.submit({ type: "input", content: "f1" }, context));
  const write = yield* awaited(root.submit({ type: "write", entry: queuedNote("w") }, context));
  const f2 = yield* awaited(
    root.submit({ type: "input", content: "f2", whenBusy: "followUp" }, context),
  );
  for (const submission of [f1, write, f2])
    expect((yield* awaited(status(submission))).status).toBe("queued");
  expect(yield* inbox(harness, root)).toEqual([
    [f1.id, "followUp"],
    [write.id, "write"],
    [f2.id, "followUp"],
  ]);
  expect(transcript(yield* allEntries(root))).toEqual(["msa.user:a"]);

  first.release();
  yield* awaited(f2.wait(context));
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "note:w",
    "msa.user:f1",
    "msa.assistant:second",
    "msa.user:f2",
    "msa.assistant:third",
  ]);
  const answers = (yield* allEntries(root)).filter((entry) => entry.kind === "msa.assistant");
  expect(yield* awaited(status(input))).toMatchObject({
    status: "done",
    answer: answers[0]!.id,
  });
  expect(yield* awaited(status(write))).toMatchObject({ status: "done" });
  expect(yield* awaited(status(f1))).toMatchObject({
    status: "done",
    answer: answers[1]!.id,
  });
  expect(yield* awaited(status(f2))).toMatchObject({
    status: "done",
    answer: answers[2]!.id,
  });
  expect(yield* inbox(harness, root)).toEqual([]);
  expect(yield* awaited(harness.snapshot(LiveDoc, root.id, context))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("queues busy submissions and places writes before user items at the final boundary, one follow-up per run", () =>
    Effect.runPromise(queuesBusySubmissions));
});

const placesEveryFollow = Effect.gen(function* () {
  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("both")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  setup.settings.followUpMode = "all";
  yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const f1 = yield* awaited(root.submit({ type: "input", content: "f1" }, context));
  const f2 = yield* awaited(root.submit({ type: "input", content: "f2" }, context));
  first.release();
  const settled = yield* awaited(f2.wait(context));
  expect(yield* awaited(status(f1))).toEqual({
    ...settled,
    id: f1.id,
    entry: expect.any(Number),
  });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant:first",
    "msa.user:f1",
    "msa.user:f2",
    "msa.assistant:both",
  ]);
  expect(setup.faux.state.callCount).toBe(2);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("places every follow-up in one successor run with followUpMode all", () =>
    Effect.runPromise(placesEveryFollow));
});

const readsQueueModes = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const first = gated(answer("first"));
  setup.faux.setResponses([first.step, answer("both")]);
  const yielded = deferred();
  addHooks(setup.registry, GenerationTask, { onYield: () => void yielded.resolve() });
  const storage = new ControlledStorage();
  const { harness, root } = yield* openChat(storage, setup);
  yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* awaited(first.reached);
  const f1 = yield* awaited(root.submit({ type: "input", content: "f1" }, context));
  const f2 = yield* awaited(root.submit({ type: "input", content: "f2" }, context));
  const held = storage.holdCommits();
  const Marker = defineDoc<{ n: number }>({
    kind: "test.marker",
    version: 1,
    scope: "session",
    initial: () => ({ n: 0 }),
  });
  const occupying = root.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          return void (yield* awaited(tx.doc(Marker))).n++;
        }),
      ),
    context,
  );
  yield* awaited(held.entered);
  first.release();
  yield* awaited(yielded.promise);
  yield* flush;
  setup.settings.followUpMode = "all";
  held.release();
  yield* awaited(occupying);
  const settled = yield* awaited(f2.wait(context));
  expect(yield* awaited(status(f1))).toEqual({
    ...settled,
    id: f1.id,
    entry: expect.any(Number),
  });
  expect(setup.faux.state.callCount).toBe(2);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("reads queue modes when the final boundary's commit runs on the Session line", () =>
    Effect.runPromise(readsQueueModes));
});

const addsSteersRun = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  setup.faux.setResponses([HOLD, answer("after tools"), answer("follow-up")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* toolRunning(harness, root);
  const steer = yield* awaited(
    root.submit({ type: "input", content: "s", whenBusy: "steer" }, context),
  );
  const followUp = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  gate.resolve();
  yield* awaited(followUp.wait(context));
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant",
    "msa.tool-result",
    "msa.user:s",
    "msa.assistant:after tools",
    "msa.user:f",
    "msa.assistant:follow-up",
  ]);
  const answers = (yield* allEntries(root)).filter((entry) => entry.kind === "msa.assistant");
  expect(yield* awaited(status(input))).toMatchObject({
    status: "done",
    answer: answers[1]!.id,
  });
  expect(yield* awaited(status(steer))).toMatchObject({
    status: "done",
    answer: answers[1]!.id,
  });
  expect(yield* awaited(status(followUp))).toMatchObject({
    status: "done",
    answer: answers[2]!.id,
  });
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("adds steers to the run at the postTools boundary and holds follow-ups for the final boundary", () =>
    Effect.runPromise(addsSteersRun));
});

const endsRunQueued = Effect.gen(function* () {
  const setup = chatSetup();
  const gate = deferred();
  holdTool(setup, gate);
  const requests: string[][] = [];
  const record: FauxResponseStep = (request) => {
    requests.push(request.messages.map((message) => `${message.role}:${textOf(message) ?? ""}`));
    return answer("fresh");
  };
  setup.faux.setResponses([HOLD, record]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const input = yield* awaited(root.submit({ type: "input", content: "a" }, context));
  yield* toolRunning(harness, root);
  const followUp = yield* awaited(root.submit({ type: "input", content: "f" }, context));
  yield* awaited(root.reset(undefined, context));
  gate.resolve();
  yield* awaited(followUp.wait(context));
  expect(yield* awaited(status(input))).toMatchObject({
    status: "unanswered",
    reason: "reset",
  });
  expect(transcript(yield* allEntries(root))).toEqual([
    "msa.user:a",
    "msa.assistant",
    "msa.tool-result",
    "msa.reset",
    "msa.user:f",
    "msa.assistant:fresh",
  ]);
  const reset = (yield* allEntries(root)).find((entry) => ResetEntry.is(entry))!;
  expect(reset.head).toBe(reset.id);
  expect(requests).toEqual([["system:", "user:f"]]);
  expect(setup.faux.state.callCount).toBe(2);
  yield* awaited(harness.close(context));
});

describe("inbox", () => {
  it("ends the run at a queued reset after tools and runs earlier follow-ups in the new context", () =>
    Effect.runPromise(endsRunQueued));
});

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
