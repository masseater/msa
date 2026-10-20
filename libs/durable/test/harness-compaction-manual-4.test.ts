import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  answer,
  directories,
  failure,
  firstUserText,
  gated,
  history,
  kinds,
  open,
  result,
  summary,
  text,
  userText,
} = harnessCompactionSupport;
const { awaited, context, deferred, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const runsFollowUps = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.agent.push(gated(gate, failure("bad request"), reached));
  const failed = yield* awaited(chat.root.submit({ content: "fails", type: "input" }, context));
  yield* awaited(reached.promise);
  const followUp = yield* awaited(
    chat.root.submit({ content: "follow-up", type: "input" }, context),
  );
  gate.resolve();
  expect((yield* awaited(failed.wait(context))).status).toBe("unanswered");
  expect((yield* awaited(followUp.status(context))).status).toBe("queued");

  chat.faux.summaries.push(summary());
  chat.faux.agent.push(answer("followed"));
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect((yield* awaited(followUp.wait(context))).status).toBe("done");
  const request = chat.faux.agentRequests.at(-1)!.messages;
  expect(firstUserText(request)).toContain("SUMMARY");
  expect(request.some((message) => userText(message) === "follow-up")).toBe(true);
  yield* awaited(chat.harness.close(context));
});

const settlesStaleReset = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  yield* awaited(chat.root.reset(undefined, context));
  gate.resolve();
  const outcome = yield* awaited(result(chat, id));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    ),
  ).toMatchObject({
    reason: "stale",
    status: "unanswered",
  });
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.reset");
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("runs follow-ups left by a failed run after placing the summary", () =>
    Effect.runPromise(runsFollowUps));

  it("settles stale when a reset lands while it summarizes", () =>
    Effect.runPromise(settlesStaleReset));
});

const doesNotMake = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const summaryGate = deferred();
  const summaryReached = deferred();
  chat.faux.summaries.push(gated(summaryGate, summary(), summaryReached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(summaryReached.promise);
  const answerGate = deferred();
  const answerReached = deferred();
  chat.faux.agent.push(gated(answerGate, answer("a4"), answerReached));
  const input = yield* awaited(chat.root.submit({ content: "u4", type: "input" }, context));
  expect((yield* awaited(input.status(context))).status).toBe("placed");
  yield* awaited(answerReached.promise);
  expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toBe(text("u1", 100));
  summaryGate.resolve();
  const outcome = yield* awaited(result(chat, id));
  const submission = (yield* awaited(
    chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  answerGate.resolve();
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  expect((yield* awaited(submission.wait(context))).status).toBe("done");
  expect((yield* kinds(chat.root)).slice(-3)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.compaction",
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("does not make the conversation busy: a submission during summarization starts its run at once", () =>
    Effect.runPromise(doesNotMake));
});
