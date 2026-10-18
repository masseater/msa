import { type AssistantMessage, fauxAssistantMessage, type Message } from "@msa/ai";
import { AssistantEntry, type Harness, LiveDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, textOf, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { open, directories, sqlitePath } from "./harness-generation-recovery-support.ts";
import { addSection } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const runTaskId = Effect.fn("runTaskId")(function* (harness: Harness) {
  const live = yield* awaited(harness.snapshot(LiveDoc, 1 as never, context));
  return live!.run!.taskId;
});

const checkpoint = Effect.fn("checkpoint")(function* (harness: Harness, id: TaskId) {
  const record = yield* awaited(harness.getTask(id, context));
  return record?.state.status === "terminal" ? undefined : record?.state.checkpoint;
});

const interruptedBeforePartial = Effect.fn("interruptedBeforePartial")(function* () {
  const path = yield* sqlitePath();
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "p", { tag: false });
  const reached = deferred();
  const sent: string[][] = [];
  const timeouts: (number | undefined)[] = [];
  setup.faux.setResponses([
    (_context, options) => {
      reached.resolve();
      return Promise.resolve(aborted(options!.signal!));
    },
    (request, options) => {
      sent.push(request.messages.map((message) => message.role));
      timeouts.push(options?.timeoutMs);
      return fauxAssistantMessage("answer");
    },
  ]);
  const opened = yield* open(path, setup);
  setup.settings.stream = { timeoutMs: 1234 };
  opened.harness.resume();
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* awaited(reached.promise);
  const taskId = yield* runTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));
  return { path, setup, sent, timeouts, id, taskId };
});

const rerunsPreparationInterrupted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const reached = deferred();
  let block = true;
  addSection(setup.registry, "preamble", (_input, ctx) =>
    runPromise(
      Effect.gen(function* () {
        if (block) {
          block = false;
          reached.resolve();
          return yield* awaited(aborted(ctx.abortSignal!));
        }
        return "p";
      }),
    ),
  );
  setup.faux.setResponses([fauxAssistantMessage("answer")]);
  let opened = yield* open(path, setup);
  opened.harness.resume();
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* awaited(reached.promise);
  const taskId = yield* runTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(yield* checkpoint(opened.harness, taskId)).toEqual({ phase: "prepare", attempt: 1 });
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect((yield* allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
  ]);
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("reruns preparation interrupted before its commit", () =>
    Effect.runPromise(rerunsPreparationInterrupted));
});

const resendsRequestInterrupted = Effect.gen(function* () {
  const { path, setup, sent, timeouts, id, taskId } = yield* interruptedBeforePartial();

  const reopened = yield* open(path, setup);
  expect(yield* checkpoint(reopened.harness, taskId)).toMatchObject({
    phase: "request",
    attempt: 1,
    thinkingLevel: "off",
    streamOptions: { timeoutMs: 1234 },
  });
  setup.settings.stream = { timeoutMs: 999 };
  expect(
    yield* awaited(reopened.harness.snapshot(LiveDoc, reopened.root.id, context)),
  ).toMatchObject({
    generation: { attempt: 1 },
  });
  reopened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(reopened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(sent).toEqual([["system", "user"]]);
  expect(timeouts).toEqual([1234]);
  expect((yield* allEntries(reopened.root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
  ]);
  yield* awaited(reopened.harness.close(context));
});

describe("generation recovery", () => {
  it("resends a request interrupted before any partial without repeating preparation", () =>
    Effect.runPromise(resendsRequestInterrupted));
});

const convertsCommittedPartial = Effect.gen(function* () {
  const path = yield* sqlitePath();
  const slow = chatSetup({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } });
  slow.faux.setResponses([fauxAssistantMessage("z".repeat(400))]);
  let opened = yield* open(path, slow);
  opened.harness.resume();
  const watch = (yield* awaited(opened.harness.watchDoc(LiveDoc, opened.root.id, context)))!;
  let watched: string | undefined;
  watch.start((value) => {
    watched = textOf(value?.generation?.message as Message) ?? watched;

    return Promise.resolve();
  });
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* waitFor(() => watched !== undefined);
  yield* awaited(opened.harness.close(context));

  const setup = chatSetup();
  const sent: string[][] = [];
  setup.faux.setResponses([
    (request) => {
      sent.push(request.messages.map((message) => message.role));
      return fauxAssistantMessage("answer");
    },
  ]);
  opened = yield* open(path, setup);
  const stored = yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context));
  const partial = textOf(stored?.generation?.message as Message)!;
  expect(partial.startsWith(watched!)).toBe(true);
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(sent).toEqual([["user"]]);
  const entries = yield* allEntries(opened.root);
  expect(entries.map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.assistant",
  ]);
  const converted = entries[1]!.model![0] as AssistantMessage;
  expect(converted.stopReason).toBe("aborted");
  expect(textOf(converted)).toBe(partial);
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({});
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("converts a committed partial into an aborted entry and resends the same messages", () =>
    Effect.runPromise(convertsCommittedPartial));
});

const resumesRetryBackoff = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  let now = 1_000;
  setup.now = () => now;
  setup.faux.setResponses([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "503 Service Unavailable",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  let opened = yield* open(path, setup);
  opened.harness.resume();
  setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        const live = yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context));
        return live?.generation?.retry !== undefined;
      }),
    ),
  );
  const taskId = yield* runTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(yield* checkpoint(opened.harness, taskId)).toEqual({
    phase: "retry",
    attempt: 1,
    until: 61_000,
  });
  expect(yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context))).toEqual({
    run: { taskId, inputs: [id] },
    generation: { attempt: 1, retry: { at: 61_000, error: "503 Service Unavailable" } },
  });
  now = 61_000;
  opened.harness.resume();
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect((yield* allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.assistant",
  ]);
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("resumes a retry backoff after reopen", () => Effect.runPromise(resumesRetryBackoff));
});

const resumesPollingDeferred = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup({ deferred: { pollAfterMs: 60_000 } });
  let now = 1_000;
  setup.now = () => now;
  setup.faux.setResponses([fauxAssistantMessage("deferred answer")]);
  let opened = yield* open(path, setup);
  opened.harness.resume();
  setup.settings.stream = { deferred: true };
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "hi" }, context))).id;
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        const live = yield* awaited(opened.harness.snapshot(LiveDoc, opened.root.id, context));
        return live?.generation?.deferred !== undefined;
      }),
    ),
  );
  const taskId = yield* runTaskId(opened.harness);
  yield* awaited(opened.harness.close(context));

  opened = yield* open(path, setup);
  expect(yield* checkpoint(opened.harness, taskId)).toMatchObject({
    phase: "poll",
    attempt: 1,
    pollAt: 61_000,
  });
  now = 61_000;
  opened.harness.resume();
  const settled = yield* awaited(
    (yield* awaited(opened.harness.submission(id, context)))!.wait(context),
  );
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);
  const answer = yield* awaited(
    opened.root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
  );
  expect(textOf(answer?.model?.[0])).toBe("deferred answer");
  expect(setup.faux.state.deferredFetchCount).toBe(1);
  yield* awaited(opened.harness.close(context));
});

describe("generation recovery", () => {
  it("resumes polling a deferred response after reopen", () =>
    Effect.runPromise(resumesPollingDeferred));
});
