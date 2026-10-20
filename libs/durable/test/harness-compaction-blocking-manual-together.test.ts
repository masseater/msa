import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const { UsageDoc } = durable;
const { watchEvents } = harnessModule;

const {
  answer,
  blockingRun,
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
  turn,
  userText,
} = harnessCompactionSupport;
const { allEntries, awaited, chatSetup, context, deferred, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const placesManualSummary = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  const run = yield* blockingRun(chat);
  chat.faux.summaries.push(summary("MANUAL"));
  const manual = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  const submission = (yield* awaited(
    chat.harness.submission(
      (manual.status === "completed" ? manual.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  chat.faux.agent.push(answer("a4"));
  run.gate.resolve();
  expect((yield* awaited(run.input.wait(context))).status).toBe("done");
  expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("BLOCKING");
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
  const markers = (yield* allEntries(chat.root)).filter(
    (record) => record.kind === "msa.compaction",
  );
  expect(markers).toHaveLength(2);
  expect(markers[1]!.head).toBe(markers[0]!.head);
  const messages = (yield* awaited(chat.root.context(context))).messages;
  expect(firstUserText(messages)).toContain("MANUAL");
  expect(messages.some((message) => userText(message).includes("BLOCKING"))).toBe(false);
  yield* awaited(chat.harness.close(context));
});

const findsNothingCompact = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  const run = yield* blockingRun(chat);
  const answerGate = deferred();
  const answerReached = deferred();
  chat.faux.agent.push(gated(answerGate, answer("a4"), answerReached));
  run.gate.resolve();
  yield* awaited(answerReached.promise);
  expect(
    yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context)))),
  ).toEqual({
    result: {},
    status: "completed",
  });
  expect(chat.faux.summaryRequests).toHaveLength(1);
  answerGate.resolve();
  expect((yield* awaited(run.input.wait(context))).status).toBe("done");
  yield* awaited(chat.harness.close(context));
});

describe("blocking and manual compaction together", () => {
  it("places a manual summary selected before the blocking one landed; its equal cut replaces it", () =>
    Effect.runPromise(placesManualSummary));

  it("finds nothing to compact for a manual compaction selected after the blocking summary landed", () =>
    Effect.runPromise(findsNothingCompact));
});

const abortsRunBoth = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  const run = yield* blockingRun(chat);
  const manualReached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary("MANUAL"), manualReached));
  const manual = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(manualReached.promise);
  expect((yield* awaited(live(chat))).compactions?.map((status) => status.blocking)).toEqual([
    true,
    false,
  ]);
  yield* awaited(chat.root.abort(context));
  expect(yield* awaited(run.input.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  expect((yield* awaited(result(chat, run.blocking))).status).toBe("aborted");
  expect((yield* awaited(result(chat, manual))).status).toBe("aborted");
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  expect((yield* awaited(live(chat))).run).toBeUndefined();
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  expect((yield* awaited(chat.harness.inspect(context))).submissions).toEqual([]);
  yield* awaited(chat.harness.close(context));
});

const placesSummarySurvived = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const reached = deferred();
  chat.faux.agent.push(gated(deferred(), answer("never"), reached));
  const busy = yield* awaited(chat.root.submit({ content: "busy", type: "input" }, context));
  yield* awaited(reached.promise);
  chat.faux.summaries.push(summary());
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  const submission = (yield* awaited(
    chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  yield* awaited(chat.root.abort(context));
  expect(yield* awaited(busy.wait(context))).toMatchObject({
    reason: "aborted",
    status: "unanswered",
  });
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  yield* turn(chat, "u5", "a5");
  expect((yield* awaited(submission.status(context))).status).toBe("done");
  const request = chat.faux.agentRequests.at(-1)!.messages;
  expect(firstUserText(request)).toContain("SUMMARY");
  expect(request.map(userText)).toContain("u5");
  const tail = (yield* allEntries(chat.root)).slice(-4).map((record) => record.kind);
  expect(tail).toEqual(["msa.compaction", "msa.user", "msa.system", "msa.assistant"]);
  yield* awaited(chat.harness.close(context));
});

describe("blocking and manual compaction together", () => {
  it("aborts the run and both compactions on Esc and appends nothing", () =>
    Effect.runPromise(abortsRunBoth));

  it("places a summary that survived Esc at the next submission, before its input", () =>
    Effect.runPromise(placesSummarySurvived));
});

const keepsPinnedModel = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup({
    models: [
      { contextWindow: 100_000, id: "faux-1", maxTokens: 900 },
      { contextWindow: 100_000, id: "faux-2", maxTokens: 900 },
    ],
  });
  const chat = yield* open({}, setup);
  yield* history(chat);
  let attempt: number | undefined;
  chat.faux.summaries.push(() =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(
          chat.root.configure({ model: { modelId: "faux-2", provider: "faux" } }, context),
        );
        return failure("overloaded");
      }),
    ),
  );
  chat.faux.summaries.push(() =>
    runPromise(
      Effect.gen(function* () {
        attempt = (yield* awaited(live(chat))).compactions?.[0]?.attempt;
        return summary();
      }),
    ),
  );
  expect(
    (yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))))).status,
  ).toBe("completed");
  expect(chat.faux.summaryRequests.map((request) => request.model)).toEqual(["faux-1", "faux-1"]);
  expect(attempt).toBe(2);
  const usage = (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models;
  expect(Object.keys(usage)).toEqual(["faux/faux-1"]);
  yield* awaited(chat.harness.close(context));
});

const showsLateJoiner = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  const stream = yield* awaited(watchEvents(chat.harness, chat.root.id, context));
  expect(stream.snapshot.compactions).toEqual([
    { attempt: 1, blocking: false, reason: "manual", taskId: id },
  ]);
  yield* awaited(stream.stop());
  yield* awaited(chat.harness.abortTask(id, context));
  yield* awaited(chat.harness.close(context));
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  it("keeps the pinned model through a retry and advances the live attempt", () =>
    Effect.runPromise(keepsPinnedModel));

  it("shows a late joiner a compaction that is summarizing", () =>
    Effect.runPromise(showsLateJoiner));
});

describe("compaction pinning, silent overflow, and late policy changes", () => {
  for (const [name, response] of [
    ["a stop whose input exceeds the window", answer("fine")],
    [
      "a length stop that fills the window without output",
      fauxAssistantMessage("", { stopReason: "length" }),
    ],
  ] as const) {
    it(`treats silent overflow as an ordinary answer: ${name}`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const chat = yield* open({ contextWindow: 300 });
          yield* history(chat);
          chat.setup.settings.compaction = {
            backgroundTokens: 0,
            enabled: true,
            keepRecentTokens: 150,
            reserveTokens: -100_000,
          };
          chat.faux.agent.push(response);
          const input = yield* awaited(chat.root.submit({ content: "go", type: "input" }, context));
          expect((yield* awaited(input.wait(context))).status).toBe("done");
          const [last] = (yield* allEntries(chat.root)).slice(-1);
          const message = last!.model![0] as AssistantMessage;
          expect(message.usage.input).toBeGreaterThanOrEqual(300);
          expect(chat.faux.summaryRequests).toHaveLength(0);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});
