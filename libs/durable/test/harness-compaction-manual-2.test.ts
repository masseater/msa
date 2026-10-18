import { type Message } from "@msa/ai";
import { type EntryRecord, UsageDoc } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  text,
  summary,
  answer,
  gated,
  history,
  turn,
  directories,
  MANUAL,
  script,
  live,
  firstUserText,
  userText,
  open,
  result,
  kinds,
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

const ordinaryWorkIdle = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const gate = deferred();
  const reached = deferred();
  chat.faux.summaries.push(gated(gate, summary(), reached));
  const id = yield* awaited(chat.root.compact(undefined, context));
  yield* awaited(reached.promise);
  let idle = false;
  const wait = chat.root.waitForIdle(context).then(() => {
    idle = true;
  });
  yield* Effect.sleep(20);
  expect(idle).toBe(false);
  gate.resolve();
  yield* awaited(wait);
  expect((yield* awaited(chat.harness.getTask(id, context)))?.state.status).toBe("terminal");
  yield* awaited(chat.harness.close(context));
});

const enablesSchedulingRight = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const setup = chatSetup();
  const faux = script(setup);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  setup.settings.compaction = { ...MANUAL, keepRecentTokens: 10 };
  const id = yield* awaited(root.compact(undefined, context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(id, context)))?.state.status === "terminal";
      }),
    ),
  );
  expect((yield* awaited(harness.getTask(id, context)))?.state).toMatchObject({
    outcome: { status: "completed", result: {} },
  });
  expect(faux.summaryRequests).toHaveLength(0);
  yield* awaited(harness.close(context));
});

describe("manual compaction", () => {
  it("is ordinary work: idle waits include it", () => Effect.runPromise(ordinaryWorkIdle));

  it("enables scheduling right after open", () => Effect.runPromise(enablesSchedulingRight));
});

const completesWithoutSummary = Effect.gen(function* () {
  const chat = yield* open();
  yield* turn(chat, "hi", "hello");
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  expect(outcome).toEqual({ status: "completed", result: {} });
  expect(chat.faux.summaryRequests).toHaveLength(0);
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("completes without a summary when there is nothing to compact", () =>
    Effect.runPromise(completesWithoutSummary));
});

const asksBeforeCompactFirst = Effect.gen(function* () {
  const chat = yield* open();
  const seen: unknown[] = [];
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: () => {
      throw new Error("hook broke");
    },
  });
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (compaction) => {
      seen.push(compaction);
      return { summary: "FROM HOOK" };
    },
  });
  addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
  yield* history(chat);
  const outcome = yield* awaited(result(chat, yield* awaited(chat.root.compact("why", context))));
  expect(outcome.status).toBe("completed");
  expect(chat.faux.summaryRequests).toHaveLength(0);
  expect(firstUserText((yield* awaited(chat.root.context(context))).messages)).toContain(
    "<summary>\nFROM HOOK\n</summary>",
  );
  expect(chat.setup.reports).toEqual([expect.objectContaining({ message: "hook broke" })]);
  const compaction = seen[0] as {
    entries: EntryRecord[];
    messages: Message[];
    firstKept: number;
  };
  expect(compaction).toMatchObject({ reason: "manual", instructions: "why" });
  expect(compaction.entries.map((record) => record.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.user",
    "msa.assistant",
  ]);
  expect(compaction.messages.filter((message) => message.role !== "system").map(userText)).toEqual([
    text("u1", 100),
    text("a1", 100),
    text("u2", 100),
    text("a2", 100),
  ]);
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("asks beforeCompact: the first decision wins, a throw is reported and skipped", () =>
    Effect.runPromise(asksBeforeCompactFirst));
});
