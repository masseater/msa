import { UsageDoc } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { allEntries, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  type Chat,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  sqlitePath,
  directories,
  first,
  MANUAL,
  reopen,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  user,
} from "./harness-compaction-support.ts";
import { addHooks } from "./harness-support.ts";
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

const resendsInterruptedSummarization = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  const usageBefore = (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!
    .models["faux/faux-1"]!;
  expect((yield* awaited(chat.harness.getTask(id, context)))?.state).toMatchObject({
    checkpoint: { phase: "summarize" },
  });
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.summaries.push(summary());
  expect((yield* awaited(result(chat, id))).status).toBe("completed");
  expect(chat.faux.summaryRequests).toHaveLength(2);
  const [, resent] = chat.faux.summaryRequests;
  expect(resent!.messages).toEqual(
    chat.faux.summaryRequests[0]!.messages.map((message) =>
      Object.assign({}, message, { timestamp: expect.any(Number) }),
    ),
  );
  const usage = (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models[
    "faux/faux-1"
  ]!;
  expect(usage.input).toBeGreaterThan(usageBefore.input);
  expect(usage.output - usageBefore.output).toBe(2);
  yield* awaited(chat.harness.close(context));
});

describe("compaction recovery", () => {
  it("resends an interrupted summarization once and counts only the answered attempt", () =>
    Effect.runPromise(resendsInterruptedSummarization));
});

const resumesRetryBackoff = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  let now = currentTimeMillis();
  chat.setup.now = () => now;
  chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
  chat.faux.summaries.push(failure("overloaded"));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(live(chat))).compactions?.[0]?.retry !== undefined;
      }),
    ),
  );
  expect((yield* awaited(chat.harness.getTask(id, context)))?.state).toMatchObject({
    checkpoint: { phase: "retry", attempt: 1 },
  });
  yield* awaited(chat.harness.close(context));
  now += 120_000;
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.summaries.push(summary());
  expect((yield* awaited(result(chat, id))).status).toBe("completed");
  expect(chat.faux.summaryRequests).toHaveLength(2);
  yield* awaited(chat.harness.close(context));
});

const keepsGenerationWaiting = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  const setup = chat.setup;
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  chat.setup.settings.compaction = { ...BLOCKING, reserveTokens: 128_000 - 700 };
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  yield* awaited(reached.promise);
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, setup, chat.faux);
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(answer("a4"));
  expect(
    (yield* awaited((yield* awaited(chat.harness.submission(input.id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect((yield* kinds(chat.root)).slice(-3)).toEqual([
    "msa.compaction",
    "msa.system",
    "msa.assistant",
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("compaction recovery", () => {
  it("resumes a retry backoff after reopen", () => Effect.runPromise(resumesRetryBackoff));

  it("keeps a generation waiting on its blocking compaction across reopen", () =>
    Effect.runPromise(keepsGenerationWaiting));
});

const keepsQueuedSummary = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  const reached = deferred();
  chat.faux.agent.push(gated(deferred(), answer("never"), reached));
  const input = yield* awaited(chat.root.submit({ type: "input", content: "busy" }, context));
  yield* awaited(reached.promise);
  chat.faux.summaries.push(summary());
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  yield* awaited(chat.harness.close(context));
  chat = yield* reopen(path, chat.setup, chat.faux);
  chat.faux.agent.push(answer("answered"));
  expect(
    (yield* awaited((yield* awaited(chat.harness.submission(input.id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    (yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.wait(context),
    )).status,
  ).toBe("done");
  yield* awaited(chat.harness.close(context));
});

describe("compaction recovery", () => {
  it("keeps a queued summary across reopen and places it at the next boundary", () =>
    Effect.runPromise(keepsQueuedSummary));
});

const queuedSummary = Effect.fn("queuedSummary")(function* (chat: Chat, content = "SUMMARY") {
  chat.faux.summaries.push(summary(content));
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  return (yield* awaited(
    chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ),
  ))!;
});

const busy = Effect.fn("busy")(function* (chat: Chat, reply = answer("done")) {
  const gate = deferred();
  const reached = deferred();
  chat.faux.agent.push(gated(gate, reply, reached));
  const input = yield* awaited(chat.root.submit({ type: "input", content: "busy" }, context));
  yield* awaited(reached.promise);
  return { input, release: () => gate.resolve() };
});

const placesResetQueued = Effect.gen(function* () {
  for (const order of ["summary first", "reset first"] as const) {
    const chat = yield* open();
    yield* history(chat);
    const run = yield* busy(chat);
    let submission: Effect.Success<ReturnType<typeof queuedSummary>>;
    if (order === "summary first") {
      submission = yield* queuedSummary(chat);
      yield* awaited(chat.root.reset(undefined, context));
    } else {
      yield* awaited(chat.root.reset(undefined, context));
      submission = yield* queuedSummary(chat);
    }
    run.release();
    yield* awaited(run.input.wait(context));
    const settled = yield* awaited(submission.wait(context));
    expect(settled.status).toBe(order === "summary first" ? "done" : "unanswered");
    expect((yield* kinds(chat.root)).at(-1)).toBe("msa.reset");
    expect((yield* awaited(chat.root.context(context))).head?.kind).toBe("msa.reset");
    yield* awaited(chat.harness.close(context));
  }
});

const placesSummaryLeft = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const run = yield* busy(chat, failure("bad request"));
  const submission = yield* queuedSummary(chat);
  run.release();
  expect((yield* awaited(run.input.wait(context))).status).toBe("unanswered");
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  yield* turn(chat, "again", "ok");
  expect((yield* awaited(submission.status(context))).status).toBe("done");
  const request = chat.faux.agentRequests.at(-1)!.messages;
  expect(firstUserText(request)).toContain("SUMMARY");
  expect(request.map(userText)).toContain("again");
  yield* awaited(chat.harness.close(context));
});

describe("compaction and the inbox", () => {
  it("places a reset queued after the summary last, and makes a summary queued after a reset stale", () =>
    Effect.runPromise(placesResetQueued));

  it("places a summary left queued by a failed run at the next submission, before its input", () =>
    Effect.runPromise(placesSummaryLeft));
});

const keepsFullRetry = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = { ...MANUAL, enabled: true };
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(
    failure("prompt is too long"),
    failure("overloaded"),
    failure("overloaded"),
    answer("finally"),
  );
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  yield* awaited(chat.harness.close(context));
});

const losesApplicationEdit = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const [u1] = yield* allEntries(chat.root);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  const edit = { target: u1!.id, action: "replace", messages: [user("REDACTED")] } as const;
  yield* awaited(
    chat.root.submit({ type: "write", entry: { kind: "app.redact", edits: [edit] } }, context),
  );
  gate.resolve();
  yield* awaited(result(chat, id));
  expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: u1 ");
  expect((yield* awaited(chat.root.context(context))).messages.map(userText)).not.toContain(
    "REDACTED",
  );
  yield* awaited(chat.harness.close(context));
});

describe("compaction and the inbox", () => {
  it("keeps the full retry budget after an overflow compaction", () =>
    Effect.runPromise(keepsFullRetry));

  it("loses an application edit placed while a compaction summarizes (spec §12)", () =>
    Effect.runPromise(losesApplicationEdit));
});

const keepsKeptEntries = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const state = yield* awaited(chat.root.viewState(context));
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  yield* waitFor(() => state.value.entries[0]?.kind === "msa.compaction");
  expect(state.value.entries).toEqual((yield* awaited(chat.root.context(context))).entries);
  state.dispose();
  yield* awaited(chat.harness.close(context));
});

describe("compaction and the inbox", () => {
  it("keeps the kept entries mounted in the conversation view", () =>
    Effect.runPromise(keepsKeptEntries));
});

const keepsOneCompaction = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  let asked = 0;
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: () => {
      asked++;
      return { decline: true };
    },
  });
  chat.faux.agent.push(failure("overloaded"));
  yield* turn(chat, text("u4", 200), "a4");
  expect(asked).toBe(1);
  expect(chat.faux.agentRequests).toHaveLength(5);
  yield* awaited(chat.harness.close(context));
});

describe("compaction edge cases", () => {
  it("keeps the one-compaction limit through a retry backoff", () =>
    Effect.runPromise(keepsOneCompaction));
});
