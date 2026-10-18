import type { AgentEvent, CompactionResult, TaskId } from "@msa/durable";
import { CompactionTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, waitFor } from "./chat-support.ts";
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
  OVERFLOW,
  BACKGROUND,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  ENABLED,
} from "./harness-compaction-support.ts";
import { addHooks, addSection } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const stopsThroughAbortTask = Effect.gen(function* () {
  for (const stop of ["task", "conversation"] as const) {
    const chat = yield* open({ contextWindow: 2000 });
    yield* history(chat);
    chat.setup.settings.compaction = BACKGROUND;
    const reached = deferred();
    chat.faux.summaries.push(gated(deferred(), summary(), reached));
    yield* turn(chat, text("u4", 100), text("a4", 100));
    yield* awaited(reached.promise);
    const [task] = yield* compactionTasks(chat);
    if (stop === "task") yield* awaited(chat.harness.abortTask(task!.id, context));
    else yield* awaited(chat.root.abort(context, { background: true }));
    expect((yield* awaited(result(chat, task!.id as TaskId<CompactionResult>))).status).toBe(
      "aborted",
    );
    expect((yield* awaited(live(chat))).compactions).toBeUndefined();
    yield* awaited(chat.harness.close(context));
  }
});

describe("background threshold compaction", () => {
  it("stops through abortTask() and Conversation.abort() with background", () =>
    Effect.runPromise(stopsThroughAbortTask));
});

const waitsCompactionAppends = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  addSection(chat.setup.registry, "extra", () => "EXTRA");
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  chat.faux.agent.push(answer("a4"));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  const generation = (yield* awaited(live(chat))).run!.taskId;
  expect(child).toMatchObject({
    owner: generation,
    background: false,
    input: { reason: "threshold" },
  });
  expect((yield* awaited(chat.harness.getTask(generation, context)))?.state).toMatchObject({
    status: "waiting",
    on: [child!.id],
    checkpoint: { phase: "prepare", attempt: 1, compacted: child!.id },
  });
  expect((yield* awaited(live(chat))).compactions).toEqual([
    { taskId: child!.id, reason: "threshold", blocking: true, attempt: 1 },
  ]);
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.user");
  gate.resolve();
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect((yield* awaited(result(chat, child!.id as TaskId<CompactionResult>))).status).toBe(
    "completed",
  );
  expect((yield* kinds(chat.root)).slice(-3)).toEqual([
    "msa.compaction",
    "msa.system",
    "msa.assistant",
  ]);
  const request = chat.faux.agentRequests.at(-1)!.messages;
  expect(firstUserText(request)).toContain("SUMMARY");
  const systems = request.filter((message) => message.role === "system");
  expect(systems).toHaveLength(1);
  expect(systems[0]).toMatchObject({
    sections: { preamble: "You are helpful.", extra: "<extra>\nEXTRA\n</extra>" },
  });
  yield* awaited(chat.harness.close(context));
});

describe("blocking threshold compaction", () => {
  it("waits for its compaction, which appends the summary before the request", () =>
    Effect.runPromise(waitsCompactionAppends));
});

const sendsRequestOnce = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = { ...BLOCKING, keepRecentTokens: 700 };
  chat.faux.summaries.push(summary());
  yield* turn(chat, text("u4", 400), "a4");
  expect(chat.faux.summaryRequests).toHaveLength(1);
  expect((yield* kinds(chat.root)).filter((kind) => kind === "msa.compaction")).toHaveLength(1);
  yield* awaited(chat.harness.close(context));
});

const sendsRequestAnyway = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
  yield* turn(chat, text("u4", 200), "a4");
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toBe(text("u1", 100));
  expect((yield* awaited(live(chat))).compactionFailure).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

const failsRunCompaction = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  chat.faux.summaries.push(failure("bad request"));
  const requests = chat.faux.agentRequests.length;
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "Compaction failed: Summarization failed: bad request",
  });
  expect(chat.faux.agentRequests).toHaveLength(requests);
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.user");
  const state = yield* awaited(live(chat));
  expect(state.compactions).toBeUndefined();
  expect(state.compactionFailure).toMatchObject({
    reason: "threshold",
    error: "Summarization failed: bad request",
  });
  yield* awaited(chat.harness.close(context));
});

describe("blocking threshold compaction", () => {
  it("sends the request once, without a second compaction, when the kept part is still above the threshold", () =>
    Effect.runPromise(sendsRequestOnce));

  it("sends the request anyway when its compaction declines", () =>
    Effect.runPromise(sendsRequestAnyway));

  it("fails the run with the compaction's error, without a request, when its compaction fails", () =>
    Effect.runPromise(failsRunCompaction));
});

const failsRunCompactionAborted = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const requests = chat.faux.agentRequests.length;
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  yield* awaited(chat.harness.abortTask(child!.id, context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "Compaction was aborted",
  });
  expect(chat.faux.agentRequests).toHaveLength(requests);
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  expect((yield* awaited(live(chat))).compactionFailure).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("blocking threshold compaction", () => {
  it("fails the run when its compaction is aborted directly", () =>
    Effect.runPromise(failsRunCompactionAborted));
});

const abortedGenerationEsc = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const events: AgentEvent[] = [];
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  stream.start((batch) => {
    events.push(...batch);

    return Promise.resolve();
  });
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  yield* awaited(chat.root.abort(context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect((yield* awaited(chat.harness.getTask(child!.id, context)))?.state).toMatchObject({
    outcome: { status: "aborted" },
  });
  yield* waitFor(() => events.some((event) => event.type === "run_end"));
  const types = events.map((event) => event.type);
  expect(types.indexOf("compaction_end")).toBeLessThan(types.indexOf("run_end"));
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.close(context));
});

describe("blocking threshold compaction", () => {
  it("is aborted with its generation by Esc, before the generation's abort handler", () =>
    Effect.runPromise(abortedGenerationEsc));
});

const winsOverBackground = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary("BACKGROUND"), reached));
  yield* turn(chat, text("u4", 100), text("a4", 100));
  yield* awaited(reached.promise);
  const [background] = yield* compactionTasks(chat);
  chat.faux.summaries.push(summary("BLOCKING"));
  yield* turn(chat, text("u5", 1000), "a5");
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain(
    "BLOCKING",
  );
  gate.resolve();
  const outcome = yield* awaited(result(chat, background!.id as TaskId<CompactionResult>));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    ),
  ).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  yield* awaited(chat.harness.close(context));
});

describe("blocking threshold compaction", () => {
  it("wins over a background compaction still in flight, which then settles stale", () =>
    Effect.runPromise(winsOverBackground));
});

const compactsRetriesSame = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = ENABLED;
  chat.faux.summaries.push(summary());
  let attempt: number | undefined;
  chat.faux.agent.push(failure(OVERFLOW));
  chat.faux.agent.push(() =>
    runPromise(
      Effect.gen(function* () {
        attempt = (yield* awaited(live(chat))).generation?.attempt;
        return answer("fits");
      }),
    ),
  );
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect(attempt).toBe(1);
  expect((yield* kinds(chat.root)).slice(-5)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.compaction",
    "msa.system",
    "msa.assistant",
  ]);
  const [compaction] = (yield* allEntries(chat.root)).filter(
    (record) => record.kind === "msa.compaction",
  );
  expect(compaction).toMatchObject({ data: { reason: "overflow" } });
  const retry = chat.faux.agentRequests.at(-1)!.messages;
  expect(retry[0]?.role).toBe("system");
  expect(userText(retry[1])).toContain("SUMMARY");
  expect(
    retry.some((message) => message.role === "assistant" && message.stopReason === "error"),
  ).toBe(false);
  yield* awaited(chat.harness.close(context));
});

describe("overflow compaction", () => {
  it("compacts and retries with the same attempt, leaving the error out of the retry", () =>
    Effect.runPromise(compactsRetriesSame));
});
