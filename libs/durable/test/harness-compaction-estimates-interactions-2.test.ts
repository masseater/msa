import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { UsageDoc } = durable;
const { CompactionTask } = harnessModule;

const {
  MANUAL,
  OVERFLOW,
  directories,
  failure,
  first,
  gated,
  history,
  live,
  open,
  reopen,
  result,
  sqlitePath,
  summary,
  text,
} = harnessCompactionSupport;
const { aborted, addHooks, allEntries, awaited, context, deferred, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const listsConcurrentCompactions = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const firstInner = deferred();
  const second = deferred();
  chat.faux.summaries.push(
    gated(deferred(), summary(), firstInner),
    gated(deferred(), summary(), second),
  );
  const a = yield* awaited(chat.root.compact(undefined, context));
  const b = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(Promise.all([firstInner.promise, second.promise]));
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
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
  );
  yield* awaited(reached.promise);
  const generation = (yield* awaited(live(chat))).run!.taskId;
  expect((yield* awaited(chat.harness.getTask(generation, context)))?.state).toMatchObject({
    checkpoint: { overflow: OVERFLOW, phase: "prepare" },
    status: "waiting",
  });
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.summaries.push(failure("bad request"));
  const settled = yield* awaited(
    (yield* awaited(chat.harness.submission(input.id, context)))!.wait(context),
  );
  expect(settled).toMatchObject({
    detail: OVERFLOW,
    reason: "model_error",
    status: "unanswered",
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
