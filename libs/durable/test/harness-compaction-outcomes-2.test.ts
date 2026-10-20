import { type AgentEvent, type CompactionResult, type TaskId } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  BACKGROUND,
  MANUAL,
  compactionTasks,
  directories,
  failure,
  firstUserText,
  gated,
  history,
  kinds,
  live,
  open,
  result,
  summary,
  text,
  turn,
} = harnessCompactionSupport;
const { awaited, context, deferred, removeDir, waitFor } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const startsAboveBackground = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  yield* turn(chat, text("u4", 100), text("a4", 100));
  yield* awaited(reached.promise);
  const [task] = yield* compactionTasks(chat);
  expect(task).toMatchObject({ background: true, input: { reason: "threshold" } });
  expect(task!.owner).toBeUndefined();
  expect((yield* awaited(live(chat))).compactions).toEqual([
    { attempt: 1, blocking: false, reason: "threshold", taskId: task!.id },
  ]);
  yield* awaited(chat.root.waitForIdle(context));
  yield* awaited(chat.root.abort(context));
  expect((yield* awaited(chat.harness.getTask(task!.id, context)))?.state.status).toBe("running");
  gate.resolve();
  const outcome = yield* awaited(result(chat, task!.id as TaskId<CompactionResult>));
  expect(outcome.status).toBe("completed");
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.compaction");
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain("SUMMARY");
  yield* awaited(chat.harness.close(context));
});

describe("background threshold compaction", () => {
  it("starts above the background threshold without blocking the run; idle waits and Esc ignore it", () =>
    Effect.runPromise(startsAboveBackground));

  for (const [name, policy] of [
    ["disabled", { ...BACKGROUND, enabled: false }],
    ["backgroundTokens is 0", { ...BACKGROUND, backgroundTokens: 0 }],
    ["there is no cut", { ...BACKGROUND, keepRecentTokens: 100_000 }],
  ] as const) {
    it(`does not start when ${name}`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const chat = yield* open({ contextWindow: 2000 });
          yield* history(chat);
          chat.setup.settings.compaction = policy;
          yield* turn(chat, text("u4", 100), text("a4", 100));
          expect(yield* compactionTasks(chat)).toEqual([]);
          expect(chat.faux.summaryRequests).toHaveLength(0);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});

const doesNotStart = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const manual = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  chat.setup.settings.compaction = BACKGROUND;
  yield* turn(chat, text("u4", 100), text("a4", 100));
  expect((yield* compactionTasks(chat)).map((task) => task.id)).toEqual([manual]);
  yield* awaited(chat.harness.abortTask(manual, context));
  yield* awaited(chat.harness.close(context));
});

describe("background threshold compaction", () => {
  it("does not start while another compaction is listed", () => Effect.runPromise(doesNotStart));
});

const recordsFailureMsa = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  chat.faux.summaries.push(failure("bad request"));
  yield* turn(chat, text("u4", 100), text("a4", 100));
  yield* waitFor(() => events.some((event) => event.type === "compaction_end"));
  const recorded = (yield* awaited(live(chat))).compactionFailure;
  expect(recorded).toMatchObject({
    error: "Summarization failed: bad request",
    reason: "threshold",
  });
  expect(events.find((event) => event.type === "compaction_end")).toEqual({
    error: "Summarization failed: bad request",
    reason: "threshold",
    taskId: recorded!.taskId,
    type: "compaction_end",
  });
  const reopened = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  expect(reopened.snapshot.compactionFailure).toEqual(recorded);
  yield* awaited(reopened.stop());
  chat.setup.settings.compaction = MANUAL;
  chat.faux.summaries.push(summary());
  const manual = yield* awaited(chat.root.compact(undefined, context));
  expect((yield* awaited(result(chat, manual))).status).toBe("completed");
  expect((yield* awaited(live(chat))).compactionFailure).toBeUndefined();
  yield* waitFor(() =>
    events.some((event) => event.type === "compaction_end" && event.taskId === manual),
  );
  expect(
    events.find((event) => event.type === "compaction_end" && event.taskId === manual),
  ).not.toHaveProperty("error");
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("background threshold compaction", () => {
  it("records a failure in msa.live, the snapshot, and compaction_end until a summary is produced", () =>
    Effect.runPromise(recordsFailureMsa));
});
