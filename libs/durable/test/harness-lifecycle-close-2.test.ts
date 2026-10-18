import { defineDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { paused } from "./harness-lifecycle-close-2-cases.ts";
import { start, oneStep } from "./harness-lifecycle-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { eventually, openTasks } from "./task-support.ts";

const closingWithQueuedWorkStep1 = Effect.fn("closingWithQueuedWorkStep1")(function* () {
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  const entry = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  const submission = yield* awaited(
    root.submit({ type: "write", entry: { kind: "note" } }, context),
  );

  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => undefined),
    context,
  );
  yield* awaited(held.entered);
  const queuedInspect = harness.inspect(context);
  const closing = harness.close(context);
  return { harness, root, entry, submission, held, blocking, queuedInspect, closing };
});

const closingWithQueuedWork = Effect.fn("closingWithQueuedWork")(function* () {
  const { harness, root, entry, submission, held, blocking, queuedInspect, closing } =
    yield* closingWithQueuedWorkStep1();
  const operations: Record<string, () => Promise<unknown>> = {
    submit: () => root.submit({ type: "input", content: "x" }, context),
    agent: () => root.agent(context),
    configure: () => root.configure({ thinkingLevel: "low" }, context),
    commit: () => root.commit(() => {}, context),
    context: () => root.context(context),
    entries: () => root.entries({}, 10, undefined, context),
    fork: () => root.fork(entry.id, { ownership: { kind: "ownerless" } }, context),
    compact: () => root.compact(undefined, context),
    reset: () => root.reset(undefined, context),
    abort: () => root.abort(context),
    conversationIdle: () => root.waitForIdle(context),
    viewState: () => root.viewState(context),
    watch: () => root.watch(context),
    taskGraph: () => harness.taskGraph(context),
    watchTaskGraph: () => harness.watchTaskGraph(context),
    status: () => submission.status(context),
    wait: () => submission.wait(context),
    abortSubmission: () => submission.abort(context),
    root: () => harness.root(context),
    conversation: () => harness.conversation(root.id, context),
    createConversation: () =>
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    getTask: () => harness.getTask(1 as TaskId, context),
    inspect: () => harness.inspect(context),
    submission: () => harness.submission(submission.id, context),
    abortTask: () => harness.abortTask(1 as TaskId, context),
    waitForTask: () => harness.waitForTask(1 as TaskId, context),
    harnessIdle: () => harness.waitForIdle(context),
    usage: () => harness.usage(context),
  };
  return { harness, held, blocking, queuedInspect, closing, operations };
});

const queuedAtSeal = Effect.fn("queuedAtSeal")(function* () {
  const Notes = defineDoc<{ text: string }>({
    kind: "test.queued-at-seal",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const Absent = defineDoc<{ text: string }>({
    kind: "test.queued-absent",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const Pending = oneStep("test.queued-pending");
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  yield* awaited(harness.commit((tx) => tx.doc(Notes).then(() => undefined), context));
  const taskId = yield* awaited(start(root, Pending));
  const write = yield* awaited(root.submit({ type: "write", entry: { kind: "note" } }, context));
  yield* awaited(write.wait(context));

  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => undefined),
    context,
  );
  yield* awaited(held.entered);
  const settle = (promise: Promise<unknown>): Promise<string> =>
    promise.then(
      (value) => (value === undefined ? "undefined" : "resolved"),
      (error: unknown) => (/closed/u.test(String(error)) ? "closed" : String(error)),
    );
  const queued = {
    context: settle(root.context(context)),
    snapshot: settle(harness.snapshot(Notes, context)),
    settledWait: settle(write.wait(context)),
    absentWatch: settle(harness.watchDoc(Absent, context)),
    absentState: settle(harness.documentState(Absent, context)),
    waitForTask: settle(harness.waitForTask(taskId, context)),
    documentState: settle(harness.documentState(Notes, context)),
    watchDoc: settle(harness.watchDoc(Notes, context)),
    viewState: settle(root.viewState(context)),
    watch: settle(root.watch(context)),
    taskGraph: settle(harness.taskGraph(context)),
  };
  return { harness, held, blocking, queued };
});

const rejectsConversationHarness = Effect.gen(function* () {
  const { harness, held, blocking, queuedInspect, closing, operations } =
    yield* closingWithQueuedWork();
  const outcomes: Record<string, string> = {};
  for (const [name, operation] of Object.entries(operations)) {
    outcomes[name] = yield* awaited(
      operation().then(
        () => "resolved",
        (error: unknown) => (/closed/u.test(String(error)) ? "closed" : String(error)),
      ),
    );
  }
  expect(outcomes).toEqual(
    Object.fromEntries(Object.keys(operations).map((name) => [name, "closed"])),
  );
  expect(() => harness.resume()).toThrow("closed");
  held.release();
  yield* awaited(blocking);
  expect((yield* awaited(queuedInspect)).scheduling).toBe("closing");
  yield* awaited(closing);
});

const completesReadsQueued = Effect.gen(function* () {
  const { harness, held, blocking, queued } = yield* queuedAtSeal();
  const closing = harness.close(context);
  held.release();
  yield* awaited(blocking);
  const outcomes: Record<string, string> = {};
  for (const [name, outcome] of Object.entries(queued)) outcomes[name] = yield* awaited(outcome);
  expect(outcomes).toEqual({
    context: "resolved",
    snapshot: "resolved",
    settledWait: "resolved",
    absentWatch: "undefined",
    absentState: "undefined",
    waitForTask: "closed",
    documentState: "closed",
    watchDoc: "closed",
    viewState: "closed",
    watch: "closed",
    taskGraph: "closed",
  });
  yield* awaited(closing);
});

describe("Harness close", () => {
  it("rejects conversation and Harness operations once close begins; inspect queued before reports closing", () =>
    Effect.runPromise(rejectsConversationHarness));

  it("completes reads queued at the seal and rejects queued waits and acquisitions that would follow commits", () =>
    Effect.runPromise(completesReadsQueued));
});

const neverSchedulesRead = Effect.gen(function* () {
  const { harness, root, id, submissionId, ran } = yield* paused();
  const Notes = defineDoc<{ text: string }>({
    kind: "test.viewer-notes",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  yield* awaited(harness.commit((tx) => tx.doc(Notes).then(() => undefined), context));
  yield* awaited(harness.inspect(context));
  yield* awaited(harness.getTask(id, context));
  yield* awaited(harness.usage(context));
  yield* awaited(harness.conversation(root.id, context));
  yield* awaited(harness.snapshot(Notes, context));
  (yield* awaited(harness.documentState(Notes, context)))!.dispose();
  yield* awaited((yield* awaited(harness.watchDoc(Notes, context)))!.stop());
  const submission = (yield* awaited(harness.submission(submissionId, context)))!;
  yield* awaited(submission.status(context));
  yield* awaited(root.agent(context));
  yield* awaited(root.context(context));
  yield* awaited(root.entries({}, 10, undefined, context));
  (yield* awaited(root.viewState(context))).dispose();
  yield* awaited((yield* awaited(root.watch(context))).stop());
  (yield* awaited(harness.taskGraph(context))).dispose();
  yield* awaited((yield* awaited(harness.watchTaskGraph(context))).stop());
  yield* flush;
  yield* flush;
  expect(ran()).toBe(false);
  expect((yield* awaited(harness.inspect(context))).scheduling).toBe("paused");
  yield* awaited(harness.close(context));
});

describe("scheduling on a paused Harness", () => {
  it("never schedules from a read-only viewer", () => Effect.runPromise(neverSchedulesRead));
});

const schedulesEveryProgress = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const calls: Record<
    string,
    (opened: Effect.Success<ReturnType<typeof paused>>) => Promise<unknown>
  > = {
    submit: ({ root }) => root.submit({ type: "write", entry: { kind: "note" } }, context),
    compact: ({ root }) => root.compact(undefined, context),
    abort: ({ root }) => root.abort(context),
    conversationIdle: ({ root }) => root.waitForIdle(context),
    submissionWait: ({ harness, submissionId }) =>
      runPromise(
        Effect.gen(function* () {
          return yield* awaited(
            (yield* awaited(harness.submission(submissionId, context)))!.wait(context),
          );
        }),
      ),
    waitForTask: ({ harness, id }) => harness.waitForTask(id, context),
    harnessIdle: ({ harness }) => harness.waitForIdle(context),
  };
  for (const [name, call] of Object.entries(calls)) {
    const opened = yield* paused();
    const pending = call(opened).catch(() => {});
    yield* eventually(() => opened.ran()).pipe(
      Effect.catchDefect(() => Effect.die(new Error(`${name} did not enable scheduling`))),
    );
    yield* awaited(opened.harness.close(context));
    yield* awaited(pending);
  }
});

describe("scheduling on a paused Harness", () => {
  it("schedules from every progress call", () => Effect.runPromise(schedulesEveryProgress));
});
