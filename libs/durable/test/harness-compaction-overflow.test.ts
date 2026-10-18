import { fauxAssistantMessage, fauxToolCall, type Message, Type } from "@msa/ai";
import { type CompactionResult, defineTool, type TaskId } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, toolsNamed } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import {
  compactionTasks,
  type Chat,
  text,
  summary,
  answer,
  gated,
  BLOCKING,
  history,
  turn,
  directories,
  MANUAL,
  OVERFLOW,
  BACKGROUND,
  failure,
  firstUserText,
  userText,
  open,
  result,
  kinds,
  ENABLED,
} from "./harness-compaction-support.ts";
import { addHooks, addSection, addTool } from "./harness-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { type Deferred, deferred } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

function slowTool(reached: Deferred<void>, gate: Deferred<void>) {
  return defineTool({
    name: "slow",
    description: "slow",
    parameters: Type.Object({}),
    execute: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          reached.resolve();
          yield* awaited(gate.promise);
          return { output: [{ type: "text", text: text("result", 200) }] };
        }),
      ),
  });
}

const failsSecondOverflow = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  chat.setup.settings.compaction = ENABLED;
  chat.faux.summaries.push(summary());
  chat.faux.agent.push(failure(OVERFLOW), failure(OVERFLOW));
  const input = yield* awaited(
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: OVERFLOW,
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
    chat.root.submit({ type: "input", content: text("u4", 100) }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
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
    chat.root.submit({ type: "input", content: text("u4", 200) }, context),
  );
  expect(yield* awaited(input.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "model_error",
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
      (chat: Chat) =>
        addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) }),
      0,
    ],
    ["fails", (chat: Chat) => chat.faux.summaries.push(failure("bad request")), 1],
    [
      "cannot cut",
      (chat: Chat) => {
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
            chat.root.submit({ type: "input", content: text("u4", 100) }, context),
          );
          expect(yield* awaited(input.wait(context))).toMatchObject({
            status: "unanswered",
            reason: "model_error",
            detail: OVERFLOW,
          });
          expect(chat.faux.summaryRequests).toHaveLength(requests);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});

describe("compaction estimates and interactions", () => {
  for (const clock of ["real", "fixed"] as const) {
    it(`ignores usage measured before a summary placed mid-run (${clock} clock)`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const setup = chatSetup({
            models: [{ id: "faux-1", contextWindow: 2000, maxTokens: 900 }],
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
            chat.root.submit({ type: "input", content: text("u4", 50) }, context),
          );
          yield* awaited(Promise.all([toolReached.promise, summaryReached.promise]));
          const [background] = yield* compactionTasks(chat);
          summaryGate.resolve();
          const queued = yield* awaited(result(chat, background!.id as TaskId<CompactionResult>));
          const submissionId =
            queued.status === "completed" ? queued.result.submissionId! : undefined;
          expect(
            (yield* awaited(
              (yield* awaited(chat.harness.submission(submissionId!, context)))!.status(context),
            )).status,
          ).toBe("queued");
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
    sections: { preamble: "You are helpful.", mood: "terse" },
  });
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("rebaselines the system prompt over kept system deltas", () =>
    Effect.runPromise(rebaselinesSystemPrompt));
});

const summarizesReplacedEntry = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const [u1] = yield* allEntries(chat.root);
  yield* awaited(
    chat.root.submit(
      {
        type: "write",
        entry: {
          kind: "app.redact",
          edits: [
            {
              target: u1!.id,
              action: "replace",
              messages: [{ role: "user", content: "REDACTED", timestamp: 0 }],
            },
          ],
        },
      },
      context,
    ),
  );
  let messages: readonly Message[] = [];
  addHooks(chat.setup.registry, CompactionTask, {
    beforeCompact: (compaction) => {
      messages = compaction.messages;
      return undefined;
    },
  });
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  expect(firstUserText(messages)).toBe("REDACTED");
  expect(userText(chat.faux.summaryRequests[0]!.messages[1])).toContain("[User]: REDACTED");
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("summarizes a replaced entry's replacement and shows it to the hook", () =>
    Effect.runPromise(summarizesReplacedEntry));
});

const compactsForkCut = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  const entries = yield* allEntries(chat.root);
  const fork = yield* awaited(
    chat.root.fork(entries.at(-1)!.id, { ownership: { kind: "ownerless" } }, context),
  );
  chat.faux.summaries.push(summary());
  const outcome = yield* awaited(result(chat, yield* awaited(fork.compact(undefined, context))));
  const submissionId = outcome.status === "completed" ? outcome.result.submissionId! : undefined;
  expect(
    (yield* awaited(
      (yield* awaited(chat.harness.submission(submissionId!, context)))!.wait(context),
    )).status,
  ).toBe("done");
  const u3 = entries.find((record) => userText(record.model?.[0]).startsWith("u3"))!;
  const view = yield* awaited(fork.context(context));
  expect(view.head).toMatchObject({
    kind: "msa.compaction",
    head: u3.id,
    conversationId: fork.id,
  });
  expect(view.messages.slice(1).map(userText)).toEqual([text("u3", 100), text("a3", 100)]);
  expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
  const state = yield* awaited(fork.viewState(context));
  expect(state.value.entries).toEqual(view.entries);
  state.dispose();
  yield* awaited(chat.harness.close(context));
});

describe("compaction estimates and interactions", () => {
  it("compacts a fork whose cut falls on a parent entry", () => Effect.runPromise(compactsForkCut));
});
