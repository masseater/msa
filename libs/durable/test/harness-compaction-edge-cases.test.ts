import { fauxAssistantMessage } from "@msa/ai";
import { type AgentEvent, type CompactionResult, type TaskId, UsageDoc } from "@msa/durable";
import { watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  compactionTasks,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  directories,
  MANUAL,
  OVERFLOW,
  BACKGROUND,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { addSection } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const doesNotStart = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  const rendering = deferred();
  const release = deferred();
  let hold = true;
  addSection(chat.setup.registry, "slow", () =>
    runPromise(
      Effect.gen(function* () {
        if (hold) {
          hold = false;
          rendering.resolve();
          yield* awaited(release.promise);
        }
        return "slow";
      }),
    ),
  );
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  chat.faux.agent.push(answer("a4"));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  yield* awaited(rendering.promise);
  const manual = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  release.resolve();
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect((yield* compactionTasks(chat)).map((task) => task.id)).toEqual([manual]);
  expect(chat.faux.summaryRequests).toHaveLength(1);
  yield* awaited(chat.harness.abortTask(manual, context));
  yield* awaited(chat.harness.close(context));
});

const startsNoBackground = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = {
    ...BACKGROUND,
    backgroundTokens: 1300,
    keepRecentTokens: 400,
  };
  chat.faux.summaries.push(summary());
  yield* turn(chat, text("u4", 1000), "a4");
  expect(chat.faux.summaryRequests).toHaveLength(1);
  expect(yield* compactionTasks(chat)).toEqual([]);
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("does not start a background compaction when a manual one was admitted during preparation", () =>
    Effect.runPromise(doesNotStart));

  it("starts no background compaction after a blocking one in the same generation", () =>
    Effect.runPromise(startsNoBackground));
});

const failsRunBlocking = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const completeSimple = chat.setup.models.completeSimple.bind(chat.setup.models);
  chat.setup.models.completeSimple = () => {
    throw new Error("no credentials");
  };
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "Compaction failed: no credentials",
  });
  chat.setup.models.completeSimple = completeSimple;
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  const state = yield* awaited(live(chat));
  expect(state.compactions).toBeUndefined();
  expect(state.compactionFailure).toMatchObject({
    reason: "threshold",
    error: "no credentials",
  });
  yield* awaited(chat.harness.close(context));
});

const failsOverflowRun = Effect.gen(function* () {
  for (const how of ["abort", "overflow"] as const) {
    const chat = yield* open();
    yield* history(chat);
    chat.setup.settings.compaction = { ...MANUAL, enabled: true };
    const reached = deferred();
    if (how === "abort") chat.faux.summaries.push(gated(deferred(), summary(), reached));
    else chat.faux.summaries.push(failure("prompt is too long for the summary"));
    chat.faux.agent.push(failure(OVERFLOW));
    const input = yield* awaited(
      chat.root.submit({ type: "input", content: text("u4", 100) }, context),
    );
    if (how === "abort") {
      yield* awaited(reached.promise);
      const [child] = yield* compactionTasks(chat);
      yield* awaited(chat.harness.abortTask(child!.id, context));
    }
    expect(yield* awaited(input.wait(context))).toMatchObject({
      status: "unanswered",
      reason: "model_error",
      detail: OVERFLOW,
    });
    expect((yield* awaited(live(chat))).compactions).toBeUndefined();
    yield* awaited(chat.harness.close(context));
  }
});

describe("compaction edge cases", () => {
  it("fails the run when its blocking compaction faults, and records the fault", () =>
    Effect.runPromise(failsRunBlocking));

  it("fails an overflow run with its text when its compaction is aborted directly or itself overflows", () =>
    Effect.runPromise(failsOverflowRun));
});

const treatsLengthStop = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = { ...MANUAL, enabled: true };
  chat.faux.agent.push(
    fauxAssistantMessage("cut short", { stopReason: "length", errorMessage: OVERFLOW }),
  );
  const input = yield* awaited(chat.root.submit({ type: "input", content: "go" }, context));
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect(chat.faux.summaryRequests).toHaveLength(0);
  yield* awaited(chat.harness.close(context));
});

const ordersEventsSummary = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  yield* waitFor(() => events.some((event) => event.type === "compaction_end"));
  const end = events.findIndex((event) => event.type === "compaction_end");
  const batch = events.slice(end - 2, end + 3).map((event) => event.type);
  expect(batch).toEqual([
    "message_start",
    "message_end",
    "compaction_end",
    "submission",
    "usage_changed",
  ]);
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("treats a length stop as an ordinary answer, not an overflow", () =>
    Effect.runPromise(treatsLengthStop));

  it("orders the events of a summary placed at once", () => Effect.runPromise(ordersEventsSummary));
});

const putsCompactionStart = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  const events: AgentEvent[][] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push([...batch]);

    return Promise.resolve();
  });
  addSection(chat.setup.registry, "extra", () => "extra");
  chat.faux.summaries.push(gated(deferred(), summary()));
  yield* turn(chat, text("u4", 100), "a4");
  yield* waitFor(() =>
    events.some((batch) => batch.some((event) => event.type === "compaction_start")),
  );
  const batch = events.find((candidate) =>
    candidate.some((event) => event.type === "compaction_start"),
  )!;
  expect(batch.map((event) => event.type)).toEqual([
    "message_start",
    "message_end",
    "compaction_start",
  ]);
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.abortTask((yield* compactionTasks(chat))[0]!.id, context));
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("puts compaction_start last in the batch of the preparation commit", () =>
    Effect.runPromise(putsCompactionStart));
});

const keepsBackgroundSummary = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 300 };
  const summaryGate = deferred();
  const summaryReached = deferred();
  chat.faux.summaries.push(gated(summaryGate, summary("BACKGROUND"), summaryReached));
  chat.faux.summaries.push(summary("BLOCKING"));
  const failed = deferred();
  chat.faux.agent.push(() => {
    failed.resolve();
    return Promise.resolve(failure("overloaded"));
  });
  chat.faux.agent.push(answer("a4"));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  yield* awaited(Promise.all([failed.promise, summaryReached.promise]));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(live(chat))).generation?.retry !== undefined;
      }),
    ),
  );
  const [background] = yield* compactionTasks(chat);
  summaryGate.resolve();
  const queued = yield* awaited(result(chat, background!.id as TaskId<CompactionResult>));
  const submission = (yield* awaited(
    chat.harness.submission(
      (queued.status === "completed" ? queued.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  chat.setup.settings.compaction = {
    ...BACKGROUND,
    reserveTokens: 1500,
    keepRecentTokens: 50,
  };
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("BLOCKING");
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("keeps a background summary queued through a retry backoff while a blocking compaction wins", () =>
    Effect.runPromise(keepsBackgroundSummary));
});

const summarizesPreviousSummary = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.faux.summaries.push(summary("FIRST"));
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  yield* turn(chat, text("u4", 100), text("a4", 100));
  yield* turn(chat, text("u5", 100), text("a5", 100));
  chat.faux.summaries.push(summary("SECOND"));
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  const prompt = userText(chat.faux.summaryRequests[1]!.messages[1]);
  expect(prompt).toMatch(
    /^<conversation>\n\[User\]: The conversation history before this point was compacted/u,
  );
  expect(prompt).toContain("FIRST");
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain("SECOND");
  yield* awaited(chat.harness.close(context));
});

const leavesNoUsage = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const chat = yield* open({ storage });
  yield* history(chat);
  const usage = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models[
          "faux/faux-1"
        ];
      }),
    );
  const before = yield* awaited(usage());
  const failure = new Error("disk gone");
  chat.faux.summaries.push(() => {
    storage.failNextCommit(failure);
    return Promise.resolve(summary());
  });
  const id = yield* awaited(chat.root.compact(undefined, context));
  expect(yield* awaited(chat.harness.closed)).toEqual({ reason: "failed", error: failure });
  yield* awaited(chat.harness.close(context));
  storage.reopen();
  expect(
    yield* awaited(storage.submissionByRequest(chat.root.id, `compaction:${id}`, context)),
  ).toBeUndefined();
  expect((yield* awaited(storage.task(id, context)))?.state.status).not.toBe("terminal");
  const reopened = yield* openChat(storage, chat.setup);
  expect(
    (yield* awaited(reopened.harness.snapshot(UsageDoc, reopened.root.id, context)))!.models[
      "faux/faux-1"
    ],
  ).toEqual(before);
  expect((yield* kinds(reopened.root)).includes("msa.compaction")).toBe(false);
  yield* awaited(reopened.harness.close(context));
});

describe("compaction edge cases", () => {
  it("summarizes the previous summary in a second compaction", () =>
    Effect.runPromise(summarizesPreviousSummary));

  it("leaves no usage, submission, or summary when the classifying commit fails, which fails the Harness", () =>
    Effect.runPromise(leavesNoUsage));
});
