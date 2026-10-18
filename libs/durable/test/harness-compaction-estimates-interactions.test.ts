import { type AgentEvent, defineTask, UsageDoc } from "@msa/durable";
import { CompactionTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  text,
  summary,
  gated,
  history,
  sqlitePath,
  directories,
  first,
  MANUAL,
  reopen,
  OVERFLOW,
  live,
  failure,
  firstUserText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addHooks, addTask } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const settlesStaleFork = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const entries = yield* allEntries(chat.root);
  const fork = yield* awaited(
    chat.root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context),
  );
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(fork.compact(undefined, context));
  yield* awaited(reached.promise);
  yield* awaited(fork.reset(undefined, context));
  gate.resolve();
  const outcome = yield* awaited(result(chat, id));
  const submission = (yield* awaited(
    chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  expect(yield* awaited(submission.status(context))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect((yield* awaited(fork.context(context))).head?.kind).toBe("msa.reset");
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("settles stale in a fork reset while it summarizes", () =>
    Effect.runPromise(settlesStaleFork));
});

const placesOlderQueued = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.agent.push(gated(gate, failure("bad request"), reached));
  const failed = yield* awaited(chat.root.submit({ type: "input", content: "fails" }, context));
  yield* awaited(reached.promise);
  chat.faux.summaries.push(summary("OLDER"));
  const older = yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  gate.resolve();
  yield* awaited(failed.wait(context));
  chat.faux.summaries.push(summary("CURRENT"));
  const current = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  const statuses = [];
  for (const outcome of [older, current]) {
    const id = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
    statuses.push(
      (yield* awaited((yield* awaited(chat.harness.submission(id!, context)))!.status(context)))
        .status,
    );
  }
  expect(statuses).toEqual(["done", "done"]);
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain("CURRENT");
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("places an older queued summary and the current one together when idle admission drains the inbox", () =>
    Effect.runPromise(placesOlderQueued));
});

const placesHookSummary = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  const childGate = deferred();
  const Child = defineChildTask(childGate);
  addTask(chat.setup.registry, Child);
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (_compaction, api, hookContext) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            chat.harness.commit(
              (tx) =>
                runPromise(
                  Effect.asVoid(
                    Effect.suspend(() =>
                      awaited(
                        tx.createTask(
                          Child,
                          {},
                          {
                            ownership: { kind: "task", taskId: api.taskId },
                            conversationId: chat.root.id,
                          },
                        ),
                      ),
                    ),
                  ),
                ),
              hookContext,
            ),
          );
          return { summary: "HOOK" };
        }),
      ),
  });
  yield* history(chat);
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(chat.harness.getTask(id, context)))?.state.status === "completing";
      }),
    ),
  );
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.compaction");
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  childGate.resolve();
  expect((yield* awaited(result(chat, id))).status).toBe("completed");
  yield* awaited(chat.harness.close(context));
});

const removesStatusFaulted = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const getModel = chat.setup.models.getModel.bind(chat.setup.models);
  chat.setup.models.getModel = () => {
    throw new Error("models broke");
  };
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  chat.setup.models.getModel = getModel;
  expect(outcome).toMatchObject({ status: "faulted", error: { message: "models broke" } });
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("places a hook's summary and holds while work the hook created runs", () =>
    Effect.runPromise(placesHookSummary));

  it("removes the status of a faulted compaction", () => Effect.runPromise(removesStatusFaulted));
});

function defineChildTask(gate: Deferred) {
  return defineTask<Record<string, never>, { phase: "run" }, null>({
    name: "test.child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            yield* awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
                taskContext,
              ),
            );
          }),
        ),
    },
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                taskContext,
              ),
            ),
          ),
        ),
      ),
  });
}

const reportsStartEnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  chat.faux.summaries.push(failure("overloaded"));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(live(chat))).compactions?.[0]?.retry !== undefined;
      }),
    ),
  );
  const late = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  expect(late.snapshot.compactions).toEqual([
    {
      taskId: id,
      reason: "manual",
      blocking: false,
      attempt: 1,
      retry: { at: expect.any(Number), error: "overloaded" },
    },
  ]);
  yield* awaited(late.stop());
  yield* awaited(chat.harness.abortTask(id, context));
  yield* waitFor(() => events.some((event) => event.type === "compaction_end"));
  expect(events.filter((event) => event.type.startsWith("compaction_"))).toEqual([
    { type: "compaction_start", taskId: id, reason: "manual", blocking: false },
    { type: "compaction_end", taskId: id, reason: "manual" },
  ]);
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("compaction events and live status", () => {
  it("reports start and end, and the retry backoff in a late joiner's snapshot", () =>
    Effect.runPromise(reportsStartEnd));
});

const listsConcurrentCompactions = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const first = deferred();
  const second = deferred();
  chat.faux.summaries.push(
    gated(deferred(), summary(), first),
    gated(deferred(), summary(), second),
  );
  const a = yield* awaited(chat.root.compact(undefined, context));
  const b = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(Promise.all([first.promise, second.promise]));
  expect((yield* awaited(live(chat))).compactions?.map((status) => status.taskId)).toEqual([a, b]);
  yield* awaited(chat.root.abort(context));
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction events and live status", () => {
  it("lists concurrent compactions in task ID order", () =>
    Effect.runPromise(listsConcurrentCompactions));
});

const repeatsNothingReopen = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  const entries = yield* allEntries(chat.root);
  const usage = yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context));
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  yield* awaited(chat.harness.waitForIdle(context));
  expect(chat.faux.summaryRequests).toHaveLength(1);
  expect(yield* allEntries(chat.root)).toEqual(entries);
  expect(yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context))).toEqual(usage);
  const inspection = yield* awaited(chat.harness.inspect(context));
  expect([inspection.tasks, inspection.submissions]).toEqual([[], []]);
  yield* awaited(chat.harness.close(context));
});

const failsOverflowRun = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  chat.setup.settings.compaction = { ...MANUAL, enabled: true };
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  chat.faux.agent.push(failure(OVERFLOW));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  yield* awaited(reached.promise);
  const generation = (yield* awaited(live(chat))).run!.taskId;
  expect((yield* awaited(chat.harness.getTask(generation, context)))?.state).toMatchObject({
    status: "waiting",
    checkpoint: { phase: "prepare", overflow: OVERFLOW },
  });
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.summaries.push(failure("bad request"));
  const settled = yield* awaited(
    (yield* awaited(chat.harness.submission(input.id, context)))!.wait(context),
  );
  expect(settled).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: OVERFLOW,
  });
  yield* awaited(chat.harness.close(context));
});

describe("compaction recovery", () => {
  it("repeats nothing after reopen once the summary is placed", () =>
    Effect.runPromise(repeatsNothingReopen));

  it("fails an overflow run with its text when its compaction fails after reopen", () =>
    Effect.runPromise(failsOverflowRun));
});

const rerunsSelectHook = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  let calls = 0;
  const reached = deferred();
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (_compaction, _api, hookContext) =>
      runPromise(
        Effect.gen(function* () {
          calls++;
          if (calls === 1) {
            reached.resolve();
            return yield* awaited(aborted(hookContext.abortSignal!));
          }
          return undefined;
        }),
      ),
  });
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.summaries.push(summary());
  expect((yield* awaited(result(chat, id))).status).toBe("completed");
  expect(calls).toBe(2);
  yield* awaited(chat.harness.close(context));
});

describe("compaction recovery", () => {
  it("reruns select and its hook after a crash in select", () =>
    Effect.runPromise(rerunsSelectHook));
});
