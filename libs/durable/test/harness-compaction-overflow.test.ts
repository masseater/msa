import ai from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import type harnessCompactionSupportTypes from "./harness-compaction-support.types.ts";
import support from "./support.ts";

const { Type, fauxAssistantMessage, fauxToolCall } = ai;

const { defineTool } = durable;
const { CompactionTask } = harnessModule;

const {
  BACKGROUND,
  BLOCKING,
  ENABLED,
  MANUAL,
  OVERFLOW,
  answer,
  compactionTasks,
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
  turn,
} = harnessCompactionSupport;
const {
  addHooks,
  addSection,
  addTool,
  awaited,
  chatSetup,
  context,
  deferred,
  removeDir,
  toolsNamed,
} = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function slowTool(reached: PromiseWithResolvers<void>, gate: PromiseWithResolvers<void>) {
  return defineTool({
    description: "slow",
    execute: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          reached.resolve();
          yield* awaited(gate.promise);
          return { output: [{ text: text("result", 200), type: "text" }] };
        }),
      ),
    name: "slow",
    parameters: Type.Object({}),
  });
}

const failsSecondOverflow = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = ENABLED;
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(failure(OVERFLOW), failure(OVERFLOW));
  const input = yield* awaited(
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    detail: OVERFLOW,
    reason: "model_error",
    status: "unanswered",
  });
  expect((yield* kinds(chat.root)).filter((kind) => kind === "msa.compaction")).toHaveLength(1);
  expect((yield* kinds(chat.root)).at(-1)).toBe("msa.assistant");
  yield* awaited(chat.harness.close(context));
});

const failsWithoutCompacting = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.faux.agent.push(failure(`overloaded: ${OVERFLOW}`));
  const input = yield* awaited(
    chat.root.submit({ content: text("u4", 100), type: "input" }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "model_error",
    status: "unanswered",
  });
  expect(chat.faux.agentRequests).toHaveLength(4);
  expect(chat.faux.summaryRequests).toHaveLength(0);
  yield* awaited(chat.harness.close(context));
});

const failsBlockingThreshold = Effect.gen(function* () {
  const chat = yield* open({ contextWindow: 1000 });
  yield* history(chat);
  chat.setup.settings.compaction = BLOCKING;
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(failure(OVERFLOW));
  const input = yield* awaited(
    chat.root.submit({ content: text("u4", 200), type: "input" }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    reason: "model_error",
    status: "unanswered",
  });
  expect(chat.faux.summaryRequests).toHaveLength(1);
  yield* awaited(chat.harness.close(context));
});

describe("overflow compaction", () => {
  it("fails a second overflow with its error entry", () => Effect.runPromise(failsSecondOverflow));

  it("fails without compacting when compaction is disabled, even for a retryable-looking overflow", () =>
    Effect.runPromise(failsWithoutCompacting));

  it("fails after a blocking threshold compaction in the same generation", () =>
    Effect.runPromise(failsBlockingThreshold));
});

describe("overflow compaction", () => {
  for (const [name, prepare, requests] of [
    [
      "declines",
      (chat: harnessCompactionSupportTypes.Chat) =>
        addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) }),
      0,
    ],
    [
      "fails",
      (chat: harnessCompactionSupportTypes.Chat) =>
        chat.faux.summaries.push(failure("bad request")),
      1,
    ],
    [
      "cannot cut",
      (chat: harnessCompactionSupportTypes.Chat) => {
        chat.setup.settings.compaction = { ...ENABLED, keepRecentTokens: 100_000 };
      },
      0,
    ],
  ] as const) {
    it(`fails with the overflow text when compaction ${name}`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const chat = yield* open();
          yield* turn(chat, text("u1", 100), text("a1", 100));
          chat.setup.settings.compaction = ENABLED;
          yield* awaited(prepare(chat));
          chat.faux.agent.push(failure(OVERFLOW));
          const input = yield* awaited(
            chat.root.submit({ content: text("u4", 100), type: "input" }, context),
          );
          expect(yield* awaited(input.wait(context))).toMatchObject({
            detail: OVERFLOW,
            reason: "model_error",
            status: "unanswered",
          });
          expect(chat.faux.summaryRequests).toHaveLength(requests);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});

const submissionStatus = (
  chat: { harness: durableTypes.Harness },
  queued: durableTypes.TaskOutcome<durableTypes.CompactionResult>,
) =>
  Effect.gen(function* () {
    const submissionId = queued.status === "completed" ? queued.result.submissionId! : undefined;
    const submission = yield* awaited(chat.harness.submission(submissionId!, context));
    return (yield* awaited(submission!.status(context))).status;
  });

describe("compaction estimates and interactions", () => {
  for (const clock of ["real", "fixed"] as const) {
    it(`ignores usage measured before a summary placed mid-run (${clock} clock)`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const setup = chatSetup({
            models: [{ contextWindow: 2000, id: "faux-1", maxTokens: 900 }],
          });
          if (clock === "fixed") setup.now = () => 1_000;
          const chat = yield* open({ contextWindow: 2000 }, setup);
          const toolGate = deferred();
          const toolReached = deferred();
          addTool(chat.setup.registry, slowTool(toolReached, toolGate));
          yield* awaited(chat.root.configure({ tools: toolsNamed(chat.setup, "slow") }, context));
          yield* turn(chat, text("u1", 220), text("a1", 220));
          yield* turn(chat, text("u2", 220), text("a2", 220));
          yield* turn(chat, text("u3", 220), text("a3", 220));
          chat.setup.settings.compaction = { ...BACKGROUND, backgroundTokens: 600 };
          chat.faux.agent.push(
            fauxAssistantMessage([fauxToolCall("slow", {})], { stopReason: "toolUse" }),
          );
          chat.faux.agent.push(answer("done"));
          const summaryGate = deferred();
          const summaryReached = deferred();
          chat.faux.summaries.push(gated(summaryGate, summary(), summaryReached));
          const input = yield* awaited(
            chat.root.submit({ content: text("u4", 50), type: "input" }, context),
          );
          yield* awaited(Promise.all([toolReached.promise, summaryReached.promise]));
          const [background] = yield* compactionTasks(chat);
          summaryGate.resolve();
          const queued = yield* awaited(
            result(chat, background!.id as durableTypes.TaskId<durableTypes.CompactionResult>),
          );
          expect(yield* submissionStatus(chat, queued)).toBe("queued");
          toolGate.resolve();
          expect((yield* awaited(input.wait(context))).status).toBe("done");
          expect(chat.faux.summaryRequests).toHaveLength(1);
          expect(yield* compactionTasks(chat)).toEqual([]);
          expect(firstUserText(chat.faux.agentRequests.at(-1)!.messages)).toContain("SUMMARY");
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});

const rebaselinesSystemPrompt = Effect.gen(function* () {
  const chat = yield* open();
  let mood = "cheerful";
  addSection(chat.setup.registry, "mood", () => mood, { tag: false });
  yield* turn(chat, text("u1", 100), text("a1", 100));
  yield* turn(chat, text("u2", 100), text("a2", 100));
  mood = "terse";
  yield* turn(chat, text("u3", 100), text("a3", 100));
  chat.setup.settings.compaction = { ...MANUAL, keepRecentTokens: 250 };
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect(
    (yield* awaited(chat.root.context(context))).entries.some(
      (record) => record.kind === "msa.system",
    ),
  ).toBe(true);
  yield* turn(chat, "next", "ok");
  const systems = chat.faux.agentRequests
    .at(-1)!
    .messages.filter((message) => message.role === "system");
  expect(systems).toHaveLength(1);
  expect(systems[0]).toMatchObject({
    sections: { mood: "terse", preamble: "You are helpful." },
  });
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("rebaselines the system prompt over kept system deltas", () =>
    Effect.runPromise(rebaselinesSystemPrompt));
});
