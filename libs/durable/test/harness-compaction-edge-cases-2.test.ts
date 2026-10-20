import { type CompactionResult, type TaskId, UsageDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  BACKGROUND,
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
  userText,
} = harnessCompactionSupport;
const { ControlledStorage, awaited, context, deferred, openChat, removeDir, waitFor } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsBackgroundSummaryStep1 = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 2000 });
  yield* history(chat);
  chat.setup.settings.compaction = BACKGROUND;
  chat.setup.settings.retry = { baseDelayMs: 300, enabled: true, maxRetries: 2 };
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
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
  );
  yield* awaited(Promise.all([failed.promise, summaryReached.promise]));
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(chat))).generation?.retry !== undefined;
    }),
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
    keepRecentTokens: 50,
    reserveTokens: 1500,
  };
  expect((yield* awaited(input.wait(context))).status).toBe("done");
  return { chat, submission };
});

const keepsBackgroundSummary = Effect.gen(function* () {
  const { chat, submission } = yield* keepsBackgroundSummaryStep1;
  expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("BLOCKING");
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    reason: "stale",
    status: "unanswered",
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
  const failureInner = new Error("disk gone");
  chat.faux.summaries.push(() => {
    storage.failNextCommit(failureInner);
    return Promise.resolve(summary());
  });
  const id = yield* awaited(chat.root.compact(undefined, context));
  expect(yield* awaited(chat.harness.closed)).toEqual({ error: failureInner, reason: "failed" });
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
