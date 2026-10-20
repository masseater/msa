import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  BACKGROUND,
  ENABLED,
  OVERFLOW,
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
const { allEntries, awaited, context, deferred, removeDir } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

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
  const outcome = yield* awaited(
    result(chat, background!.id as durableTypes.TaskId<durableTypes.CompactionResult>),
  );
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
    ),
  ).toMatchObject({
    reason: "stale",
    status: "unanswered",
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
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
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
