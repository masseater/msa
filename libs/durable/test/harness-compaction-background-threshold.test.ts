import type { AgentEvent, CompactionResult, TaskId } from "@msa/durable";
import { CompactionTask, watchEvents } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  BACKGROUND,
  BLOCKING,
  answer,
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
const { addHooks, addSection, awaited, context, deferred, removeDir, waitFor } = support;

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
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  const generation = (yield* awaited(live(chat))).run!.taskId;
  expect(child).toMatchObject({
    background: false,
    input: { reason: "threshold" },
    owner: generation,
  });
  expect((yield* awaited(chat.harness.getTask(generation, context)))?.state).toMatchObject({
    checkpoint: { attempt: 1, compacted: child!.id, phase: "prepare" },
    on: [child!.id],
    status: "waiting",
  });
  expect((yield* awaited(live(chat))).compactions).toEqual([
    { attempt: 1, blocking: true, reason: "threshold", taskId: child!.id },
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
    sections: { extra: "<extra>\nEXTRA\n</extra>", preamble: "You are helpful." },
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
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    detail: "Compaction failed: Summarization failed: bad request",
    reason: "model_error",
    status: "unanswered",
  });
  expect(chat.faux.agentRequests).toHaveLength(requests);
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.user");
  const state = yield* awaited(live(chat));
  expect(state.compactions).toBeUndefined();
  expect(state.compactionFailure).toMatchObject({
    error: "Summarization failed: bad request",
    reason: "threshold",
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
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  yield* awaited(chat.harness.abortTask(child!.id, context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    detail: "Compaction was aborted",
    reason: "model_error",
    status: "unanswered",
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
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  yield* awaited(reached.promise);
  const [child] = yield* compactionTasks(chat);
  yield* awaited(chat.root.abort(context));
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
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
