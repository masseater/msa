import { Type, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { ProviderDoc, defineTool } from "@msa/durable";
import { CompactionTask } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessCompactionSupport from "./harness-compaction-support.ts";
import support from "./support.ts";

const {
  MANUAL,
  answer,
  compactionInput,
  directories,
  failure,
  history,
  kinds,
  live,
  open,
  result,
  summary,
} = harnessCompactionSupport;
const { addHooks, addTool, awaited, context, removeDir, toolsNamed } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const completesWithoutSummary = Effect.gen(function* () {
  const chat = yield* open();
  addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => ({ decline: true }) });
  yield* history(chat);
  expect(
    yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context)))),
  ).toEqual({
    result: {},
    status: "completed",
  });
  expect(chat.faux.summaryRequests).toHaveLength(0);
  yield* awaited(chat.harness.close(context));
});

const failsNoModel = Effect.gen(function* () {
  const chat = yield* open();
  yield* history(chat);
  yield* awaited(chat.root.configure({ model: null }, context));
  const outcome = yield* awaited(
    result(chat, yield* awaited(chat.root.compact(undefined, context))),
  );
  expect(outcome).toMatchObject({
    error: { detail: { reason: "no_model" } },
    status: "failed",
  });
  expect((yield* awaited(live(chat))).compactions).toBeUndefined();
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("completes without a summary when a hook declines", () =>
    Effect.runPromise(completesWithoutSummary));

  it("fails with no_model without a configured model", () => Effect.runPromise(failsNoModel));
});

const retriesRetryableErrorStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const single = yield* open();
  yield* history(single);
  yield* awaited(single.root.configure({ thinkingLevel: "high" }, context));
  single.faux.summaries.push(summary());
  const once = yield* compactionInput(single, () =>
    runPromise(
      Effect.gen(function* () {
        return yield* awaited(
          result(single, yield* awaited(single.root.compact(undefined, context))),
        );
      }),
    ),
  );
  expect(once).toBeGreaterThan(0);
  yield* awaited(single.harness.close(context));

  const chat = yield* open();
  yield* history(chat);
  yield* awaited(chat.root.configure({ thinkingLevel: "high" }, context));
  chat.setup.settings.stream = { deferred: true, timeoutMs: 1234 };
  chat.faux.summaries.push(() =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(chat.root.configure({ thinkingLevel: "low" }, context));
        chat.setup.settings.stream = { timeoutMs: 1 };
        return failure("overloaded");
      }),
    ),
  );
  chat.faux.summaries.push(summary());
  const twice = yield* compactionInput(chat, () =>
    runPromise(
      Effect.gen(function* () {
        expect(
          (yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context)))))
            .status,
        ).toBe("completed");
      }),
    ),
  );
  expect(chat.faux.summaryRequests).toHaveLength(2);
  return { chat, once, twice };
});

const retriesRetryableError = Effect.gen(function* () {
  const { once, chat, twice } = yield* retriesRetryableErrorStep1;
  expect(twice).toBe(2 * once);
  const sessionId = (yield* awaited(chat.harness.snapshot(ProviderDoc, chat.root.id, context)))!
    .sessionId;
  for (const request of chat.faux.summaryRequests) {
    expect(request.options).toMatchObject({
      cacheRetention: "none",
      reasoning: "high",
      sessionId,
      timeoutMs: 1234,
    });
    expect(request.options?.deferred).toBeUndefined();
  }
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("retries a retryable error with the pinned request and counts every attempt once", () =>
    Effect.runPromise(retriesRetryableError));
});

const addsNoUsage = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  for (const decision of [{ decline: true } as const, { summary: "HOOK" }]) {
    const chat = yield* open();
    addHooks(chat.setup.registry, CompactionTask, { beforeCompact: () => decision });
    yield* history(chat);
    expect(
      yield* compactionInput(chat, () =>
        runPromise(
          Effect.gen(function* () {
            return yield* awaited(
              result(chat, yield* awaited(chat.root.compact(undefined, context))),
            );
          }),
        ),
      ),
    ).toBe(0);
    yield* awaited(chat.harness.close(context));
  }
});

const capsMaxTokensModel = Effect.gen(function* () {
  const chat = yield* open();
  addTool(
    chat.setup.registry,
    defineTool({
      description: "read",
      execute: () => Promise.resolve({ output: [] }),
      name: "read",
      parameters: Type.Object({}),
    }),
  );
  yield* awaited(chat.root.configure({ tools: toolsNamed(chat.setup, "read") }, context));
  yield* history(chat);
  chat.setup.settings.compaction = { ...MANUAL, reserveTokens: 2000 };
  chat.faux.summaries.push(summary());
  yield* awaited(result(chat, yield* awaited(chat.root.compact(undefined, context))));
  const request = chat.faux.summaryRequests[0]!;
  expect(request.options?.maxTokens).toBe(900);
  expect(request.messages).toHaveLength(2);
  expect(
    request.messages.some(
      (message) => message.role === "system" && message.toolsAdded !== undefined,
    ),
  ).toBe(false);
  yield* awaited(chat.harness.close(context));
});

describe("compaction outcomes", () => {
  it("adds no usage when a hook declines or supplies the summary", () =>
    Effect.runPromise(addsNoUsage));

  it("caps maxTokens at the model's output limit and sends no tools", () =>
    Effect.runPromise(capsMaxTokensModel));
});

describe("compaction outcomes", () => {
  for (const [name, response, message] of [
    ["retries run out", failure("overloaded"), "Summarization failed: overloaded"],
    ["a non-retryable error", failure("bad request"), "Summarization failed: bad request"],
    [
      "a length stop",
      fauxAssistantMessage("partial", { stopReason: "length" }),
      "Summarization hit the token limit; the summary is incomplete",
    ],
    [
      "a tool call",
      fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "stop" }),
      "Summarization attempted to call a tool",
    ],
    ["empty text", answer("  "), "Summarization produced no text"],
  ] as const) {
    it(`fails with model_error on ${name}`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const chat = yield* open();
          yield* history(chat);
          for (let index = 0; index < 3; index++) chat.faux.summaries.push(response);
          const outcome = yield* awaited(
            result(chat, yield* awaited(chat.root.compact(undefined, context))),
          );
          expect(outcome).toMatchObject({
            error: { detail: { reason: "model_error" }, message },
            status: "failed",
          });
          expect(chat.faux.summaryRequests).toHaveLength(name === "retries run out" ? 3 : 1);
          expect((yield* awaited(live(chat))).compactions).toBeUndefined();
          expect((yield* kinds(chat.root)).includes("msa.compaction")).toBe(false);
          yield* awaited(chat.harness.close(context));
        }),
      ));
  }
});
