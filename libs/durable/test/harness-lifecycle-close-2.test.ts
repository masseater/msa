import { type TaskId, defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import paused from "./harness-lifecycle-close-2-cases.ts";
import harnessLifecycleSupport from "./harness-lifecycle-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { oneStep, start } = harnessLifecycleSupport;
const { ControlledStorage, context, flush } = sessionSupport;
const { eventually, openTasks } = taskSupport;

const closingWithQueuedWorkStep1 = Effect.fn("closingWithQueuedWorkStep1")(function* () {
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  const entry = yield* awaited(
    root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
  );
  const submission = yield* awaited(
    root.submit({ entry: { kind: "note" }, type: "write" }, context),
  );

  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => undefined),
    context,
  );
  yield* awaited(held.entered);
  const queuedInspect = harness.inspect(context);
  const closing = harness.close(context);
  return { blocking, closing, entry, harness, held, queuedInspect, root, submission };
});

const closingWithQueuedWork = Effect.fn("closingWithQueuedWork")(function* () {
  const { harness, root, entry, submission, held, blocking, queuedInspect, closing } =
    yield* closingWithQueuedWorkStep1();
  const operations: Record<string, () => Promise<unknown>> = {
    abort: () => root.abort(context),
    abortSubmission: () => submission.abort(context),
    abortTask: () => harness.abortTask(1 as TaskId, context),
    agent: () => root.agent(context),
    commit: () => root.commit(() => {}, context),
    compact: () => root.compact(undefined, context),
    configure: () => root.configure({ thinkingLevel: "low" }, context),
    context: () => root.context(context),
    conversation: () => harness.conversation(root.id, context),
    conversationIdle: () => root.waitForIdle(context),
    createConversation: () =>
      harness.createConversation({ ownership: { kind: "ownerless" } }, context),
    entries: () => root.entries({}, 10, undefined, context),
    fork: () => root.fork(entry.id, { ownership: { kind: "ownerless" } }, context),
    getTask: () => harness.getTask(1 as TaskId, context),
    harnessIdle: () => harness.waitForIdle(context),
    inspect: () => harness.inspect(context),
    reset: () => root.reset(undefined, context),
    root: () => harness.root(context),
    status: () => submission.status(context),
    submission: () => harness.submission(submission.id, context),
    submit: () => root.submit({ content: "x", type: "input" }, context),
    taskGraph: () => harness.taskGraph(context),
    usage: () => harness.usage(context),
    viewState: () => root.viewState(context),
    wait: () => submission.wait(context),
    waitForTask: () => harness.waitForTask(1 as TaskId, context),
    watch: () => root.watch(context),
    watchTaskGraph: () => harness.watchTaskGraph(context),
  };
  return { blocking, closing, harness, held, operations, queuedInspect };
});

const queuedAtSeal = Effect.fn("queuedAtSeal")(function* () {
  const Notes = defineDoc<{ text: string }>({
    initial: () => ({ text: "" }),
    kind: "test.queued-at-seal",
    scope: "session",
    version: 1,
  });
  const Absent = defineDoc<{ text: string }>({
    initial: () => ({ text: "" }),
    kind: "test.queued-absent",
    scope: "session",
    version: 1,
  });
  const Pending = oneStep("test.queued-pending");
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  yield* awaited(harness.commit((tx) => tx.doc(Notes).then(() => undefined), context));
  const taskId = yield* awaited(start(root, Pending));
  const write = yield* awaited(root.submit({ entry: { kind: "note" }, type: "write" }, context));
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
    absentState: settle(harness.documentState(Absent, context)),
    absentWatch: settle(harness.watchDoc(Absent, context)),
    context: settle(root.context(context)),
    documentState: settle(harness.documentState(Notes, context)),
    settledWait: settle(write.wait(context)),
    snapshot: settle(harness.snapshot(Notes, context)),
    taskGraph: settle(harness.taskGraph(context)),
    viewState: settle(root.viewState(context)),
    waitForTask: settle(harness.waitForTask(taskId, context)),
    watch: settle(root.watch(context)),
    watchDoc: settle(harness.watchDoc(Notes, context)),
  };
  return { blocking, harness, held, queued };
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
    absentState: "undefined",
    absentWatch: "undefined",
    context: "resolved",
    documentState: "closed",
    settledWait: "resolved",
    snapshot: "resolved",
    taskGraph: "closed",
    viewState: "closed",
    waitForTask: "closed",
    watch: "closed",
    watchDoc: "closed",
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
    initial: () => ({ text: "" }),
    kind: "test.viewer-notes",
    scope: "session",
    version: 1,
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
    abort: ({ root }) => root.abort(context),
    compact: ({ root }) => root.compact(undefined, context),
    conversationIdle: ({ root }) => root.waitForIdle(context),
    harnessIdle: ({ harness }) => harness.waitForIdle(context),
    submissionWait: ({ harness, submissionId }) =>
      runPromise(
        Effect.gen(function* () {
          return yield* awaited(
            (yield* awaited(harness.submission(submissionId, context)))!.wait(context),
          );
        }),
      ),
    submit: ({ root }) => root.submit({ entry: { kind: "note" }, type: "write" }, context),
    waitForTask: ({ harness, id }) => harness.waitForTask(id, context),
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
