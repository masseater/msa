import { UsageDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
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
  reopen,
  live,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { waitFor, awaited, removeDir, context, deferred } from "./support.ts";

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
  const path = yield* sqlitePath();
  let chat = yield* awaited(first(path));
  let now = currentTimeMillis();
  chat.setup.now = () => now;
  chat.setup.settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 60_000 };
  chat.faux.summaries.push(failure("overloaded"));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(chat))).compactions?.[0]?.retry !== undefined;
    }),
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
