import { defineDoc, MemoryStorage, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { start, oneStep } from "./harness-lifecycle-support.ts";
import { addTask } from "./harness-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { eventually, openTasks } from "./task-support.ts";

async function closingWithQueuedWork() {
  const storage = new ControlledStorage();
  const { harness } = await openTasks(storage, []);
  const root = await harness.root(context);
  const entry = await root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context);
  const submission = await root.submit({ type: "write", entry: { kind: "note" } }, context);

  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => {}),
    context,
  );
  await held.entered;
  const queuedInspect = harness.inspect(context);
  const closing = harness.close(context);
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
}

async function queuedAtSeal() {
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
  const { harness } = await openTasks(storage, []);
  const root = await harness.root(context);
  await harness.commit((tx) => tx.doc(Notes).then(() => {}), context);
  const taskId = await start(root, Pending);
  const write = await root.submit({ type: "write", entry: { kind: "note" } }, context);
  await write.wait(context);

  const held = storage.holdCommits();
  const blocking = harness.commit(
    (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => {}),
    context,
  );
  await held.entered;
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
}

describe("Harness close", () => {
  it("rejects conversation and Harness operations once close begins; inspect queued before reports closing", async () => {
    const { harness, held, blocking, queuedInspect, closing, operations } =
      await closingWithQueuedWork();
    const outcomes: Record<string, string> = {};
    for await (const [name, operation] of Object.entries(operations)) {
      outcomes[name] = await operation().then(
        () => "resolved",
        (error: unknown) => (/closed/u.test(String(error)) ? "closed" : String(error)),
      );
    }
    expect(outcomes).toEqual(
      Object.fromEntries(Object.keys(operations).map((name) => [name, "closed"])),
    );
    expect(() => harness.resume()).toThrow("closed");
    held.release();
    await blocking;
    expect((await queuedInspect).scheduling).toBe("closing");
    await closing;
  });

  it("completes reads queued at the seal and rejects queued waits and acquisitions that would follow commits", async () => {
    const { harness, held, blocking, queued } = await queuedAtSeal();
    const closing = harness.close(context);
    held.release();
    await blocking;
    const outcomes: Record<string, string> = {};
    for await (const [name, outcome] of Object.entries(queued)) outcomes[name] = await outcome;
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
    await closing;
  });
});

// Open a paused Harness with one background task pending and a queued write submission.
async function paused() {
  let ran = false;
  const Marker = oneStep("test.marker", () => {
    ran = true;

    return Promise.resolve();
  });
  const { harness } = await openTasks(new MemoryStorage(), [Marker]);
  const root = await harness.root(context);
  // Background, so idle waits and conversation abort leave it alone.
  const id = await start(root, Marker, true);
  const submissionId = await harness.commit(
    async (tx) =>
      (await tx.createSubmission({ conversationId: root.id, type: "write", status: "queued" })).id,
    context,
  );
  return { harness, root, id, submissionId, ran: () => ran };
}

describe("scheduling on a paused Harness", () => {
  it("never schedules from a read-only viewer", async () => {
    const { harness, root, id, submissionId, ran } = await paused();
    const Notes = defineDoc<{ text: string }>({
      kind: "test.viewer-notes",
      version: 1,
      scope: "session",
      initial: () => ({ text: "" }),
    });
    await harness.commit((tx) => tx.doc(Notes).then(() => {}), context);
    await harness.inspect(context);
    await harness.getTask(id, context);
    await harness.usage(context);
    await harness.conversation(root.id, context);
    await harness.snapshot(Notes, context);
    (await harness.documentState(Notes, context))!.dispose();
    await (await harness.watchDoc(Notes, context))!.stop();
    const submission = (await harness.submission(submissionId, context))!;
    await submission.status(context);
    await root.agent(context);
    await root.context(context);
    await root.entries({}, 10, undefined, context);
    (await root.viewState(context)).dispose();
    await (await root.watch(context)).stop();
    (await harness.taskGraph(context)).dispose();
    await (await harness.watchTaskGraph(context)).stop();
    await flush();
    await flush();
    expect(ran()).toBe(false);
    expect((await harness.inspect(context)).scheduling).toBe("paused");
    await harness.close(context);
  });
});

describe("scheduling on a paused Harness", () => {
  it("schedules from every progress call", async () => {
    const calls: Record<string, (opened: Awaited<ReturnType<typeof paused>>) => Promise<unknown>> =
      {
        submit: ({ root }) => root.submit({ type: "write", entry: { kind: "note" } }, context),
        compact: ({ root }) => root.compact(undefined, context),
        abort: ({ root }) => root.abort(context),
        conversationIdle: ({ root }) => root.waitForIdle(context),
        submissionWait: async ({ harness, submissionId }) =>
          (await harness.submission(submissionId, context))!.wait(context),
        waitForTask: ({ harness, id }) => harness.waitForTask(id, context),
        harnessIdle: ({ harness }) => harness.waitForIdle(context),
      };
    for await (const [name, call] of Object.entries(calls)) {
      const opened = await paused();
      // A queued write's wait settles only on placement; close rejects it.
      const pending = call(opened).catch(() => {});
      await eventually(() => Promise.resolve(opened.ran())).catch(() => {
        throw new Error(`${name} did not enable scheduling`);
      });
      await opened.harness.close(context);
      await pending;
    }
  });
});

describe("registry changes before resume", () => {
  it("runs what the registry holds at resume: a definition installed or replaced after open", async () => {
    const log: string[] = [];
    const define = (label: string) =>
      oneStep("test.late-definition", () => {
        log.push(label);

        return Promise.resolve();
      });
    const storage = new MemoryStorage();
    const first = await openTasks(storage, []);
    const root = await first.harness.root(context);
    const missing = await start(root, define("unused"));
    expect((await first.harness.inspect(context)).tasks).toMatchObject([
      { state: { kind: "blocked", reason: "missing_task" } },
    ]);
    const installed = addTask(first.registry, define("v1"));
    expect((await first.harness.inspect(context)).tasks).toMatchObject([
      { state: { kind: "ready" } },
    ]);
    // The same extension name replaces the definition in place, still before resume.
    installed.dispose();
    addTask(first.registry, define("v2"));
    first.harness.resume();
    await first.harness.waitForTask(missing, context);
    expect(log).toEqual(["v2"]);
    await first.harness.close(context);
  });
});
