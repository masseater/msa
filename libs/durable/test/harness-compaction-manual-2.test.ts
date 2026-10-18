import { UsageDoc } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  text,
  summary,
  answer,
  gated,
  history,
  turn,
  directories,
  MANUAL,
  live,
  firstUserText,
  userText,
  open,
  result,
  kinds,
} from "./harness-compaction-support.ts";
import { awaited, removeDir, context, deferred } from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const countsSpendSummary = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const chat = yield* open();
  yield* history(chat);
  const input = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(chat.harness.snapshot(UsageDoc, chat.root.id, context)))!.models[
          "faux/faux-1"
        ]!.input;
      }),
    );
  const before = yield* awaited(input());
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  yield* awaited(chat.root.reset(undefined, context));
  gate.resolve();
  const outcome = yield* awaited(result(chat, id));
  const submission = (yield* awaited(
    chat.harness.submission(
      (outcome.status === "completed" ? outcome.result.submissionId : undefined)!,
      context,
    ),
  ))!;
  expect(yield* awaited(submission.status(context))).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect(yield* awaited(input())).toBeGreaterThan(before);
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("counts the spend of a summary that ends stale, and writes no entry for it", () =>
    Effect.runPromise(countsSpendSummary));
});

const letsCompactionCuts = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const first = deferred();
  const firstReached = deferred();
  chat.faux.summaries.push(gated(first, summary("FIRST"), firstReached));
  const early = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(firstReached.promise);
  yield* turn(chat, text("u4", 100), text("a4", 100));
  chat.faux.summaries.push(summary("SECOND"));
  const later = yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect(later.status).toBe("completed");
  first.resolve();
  const outcome = yield* awaited(result(chat, early));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    ),
  ).toMatchObject({
    status: "unanswered",
    reason: "stale",
  });
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain("SECOND");
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("lets the compaction that cuts furthest win, whatever finishes first", () =>
    Effect.runPromise(letsCompactionCuts));
});

const placesOlderSelected = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary("A"), reached));
  const a = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 350 };
  chat.faux.summaries.push(summary("B"));
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain("B");
  gate.resolve();
  const outcome = yield* awaited(result(chat, a));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    (yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    )).status,
  ).toBe("done");
  const messages = (yield* awaited(chat.root.context(context))).messages;
  expect(firstUserText(messages)).toContain("<summary>\nA\n</summary>");
  expect(messages.slice(1).map(userText)).toEqual([text("u3", 100), text("a3", 100)]);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("places an older-selected summary that cuts later than the newer one", () =>
    Effect.runPromise(placesOlderSelected));
});

describe("manual compaction", () => {
  for (const [order, keeps, stale] of [
    ["before", [150, 350], true],
    ["at", [150, 150], false],
    ["after", [350, 150], false],
  ] as const) {
    it(`places two queued summaries in one boundary when the second cuts ${order} the first`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const chat = yield* open();
          yield* history(chat);
          const gate = deferred();
          const reached = deferred();
          chat.faux.agent.push(gated(gate, answer("done"), reached));
          const input = yield* awaited(
            chat.root.submit({ type: "input", content: "busy" }, context),
          );
          yield* awaited(reached.promise);
          const submissions = [];
          for (const [index, keep] of keeps.entries()) {
            chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: keep };
            chat.faux.summaries.push(summary(`S${index}`));
            const outcome = yield* awaited(
              result(chat, yield* awaited(chat.root.compact(undefined, context))),
            );
            submissions.push(
              outcome.status === "completed" ? outcome.result.submissionId! : undefined,
            );
          }
          gate.resolve();
          yield* awaited(input.wait(context));
          const statuses = [];
          for (const id of submissions)
            statuses.push(
              (yield* awaited(
                (yield* awaited(chat.harness.submission(id!, context)))!.wait(context),
              )).status,
            );
          expect(statuses).toEqual(["done", stale ? "unanswered" : "done"]);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});

const abortedConversationAbort = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const reached = deferred();
  chat.faux.summaries.push(gated(deferred(), summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  expect((yield* awaited(live(chat))).compactions).toHaveLength(1);
  yield* awaited(chat.root.abort(context));
  expect((yield* awaited(result(chat, id))).status).toBe("aborted");
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);

  const gate = deferred();
  const busy = deferred();
  chat.faux.agent.push(gated(gate, answer("never"), busy));
  yield* awaited(chat.root.submit({ type: "input", content: "busy" }, context));
  yield* awaited(busy.promise);
  chat.faux.summaries.push(summary());
  const queued = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  yield* awaited(chat.root.abort(context));
  const submissionId = queued.status === "completed" ? queued.result.submissionId! : undefined;
  const submission = (yield* awaited(chat.harness.submission(submissionId!, context)))!;
  expect((yield* awaited(submission.status(context))).status).toBe("queued");
  expect(yield* awaited(submission.abort(context))).toBe("aborted");
  yield* turn(chat, "next", "ok");
  expect(yield* awaited(submission.status(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  yield* awaited(chat.harness.close(context));
});

describe("manual compaction", () => {
  it("is aborted by Conversation.abort(); an already queued summary survives it", () =>
    Effect.runPromise(abortedConversationAbort));
});
