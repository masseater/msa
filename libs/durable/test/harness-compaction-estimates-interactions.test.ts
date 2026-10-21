import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { CompactionTask, watchEvents } = harnessModule;
const { defineTask } = durable;

const { directories, failure, firstUserText, gated, history, kinds, live, open, result, summary } =
  harnessCompactionSupport;
const { addHooks, addTask, allEntries, awaited, context, deferred, removeDir, waitFor } = support;

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
    reason: "stale",
    status: "unanswered",
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
  const failed = yield* awaited(chat.root.submit({ content: "fails", type: "input" }, context));
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

const placesHookSummaryStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  const childGate = deferred();
  const Child = defineChildTask(childGate);
  addTask(chat.setup.registry, Child);
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (_compaction, api, hookContext) =>
      runPromise(
        Effect.gen(function* () {
          const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            chat.harness.commit(
              (tx) =>
                runNested(
                  Effect.asVoid(
                    Effect.suspend(() =>
                      awaited(
                        tx.createTask(
                          Child,
                          {},
                          {
                            conversationId: chat.root.id,
                            ownership: { kind: "task", taskId: api.taskId },
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
  return { chat, childGate, id };
});

const placesHookSummary = Effect.gen(function* () {
  const { chat, childGate, id } = yield* placesHookSummaryStep1;
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(chat.harness.getTask(id, context)))?.state.status === "completing";
    }),
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
  expect(outcome).toMatchObject({ error: { message: "models broke" }, status: "faulted" });
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("places a hook's summary and holds while work the hook created runs", () =>
    Effect.runPromise(placesHookSummary));

  it("removes the status of a faulted compaction", () => Effect.runPromise(removesStatusFaulted));
});

function defineChildTask(gate: PromiseWithResolvers<void>) {
  return defineTask<Record<string, never>, { phase: "run" }, null>({
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ outcome: { status: "aborted" }, status: "terminal" }),
                taskContext,
              ),
            ),
          ),
        ),
      ),
    initial: () => ({ phase: "run" }),
    name: "test.child",
    phases: {
      run: (_task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(gate.promise);
            yield* awaited(
              runtime.commit(
                () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
                taskContext,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
}

const reportsStartEnd = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.retry = { baseDelayMs: 60_000, enabled: true, maxRetries: 2 };
  const events: durableTypes.AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  chat.faux.summaries.push(failure("overloaded"));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(chat))).compactions?.[0]?.retry !== undefined;
    }),
  );
  const late = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  expect(late.snapshot.compactions).toEqual([
    {
      attempt: 1,
      blocking: false,
      reason: "manual",
      retry: { at: expect.any(Number), error: "overloaded" },
      taskId: id,
    },
  ]);
  yield* awaited(late.stop());
  yield* awaited(chat.harness.abortTask(id, context));
  yield* waitFor(() => events.some((event) => event.type === "compaction_end"));
  expect(events.filter((event) => event.type.startsWith("compaction_"))).toEqual([
    { blocking: false, reason: "manual", taskId: id, type: "compaction_start" },
    { reason: "manual", taskId: id, type: "compaction_end" },
  ]);
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("compaction events and live status", () => {
  it("reports start and end, and the retry backoff in a late joiner's snapshot", () =>
    Effect.runPromise(reportsStartEnd));
});
