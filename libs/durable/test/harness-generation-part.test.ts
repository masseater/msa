import {
  type AssistantMessage,
  fauxAssistantMessage,
  type Message,
  type SimpleStreamOptions,
} from "@msa/ai";
import { AssistantEntry, ProviderDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  allEntries,
  type ChatSetup,
  chatSetup,
  openChat,
  textOf,
  waitFor,
} from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { livePublications, runTask, live } from "./harness-generation-support.ts";
import { context } from "./session-support.ts";

const pollsDeferredResponse = Effect.gen(function* () {
  const setup = chatSetup({ deferred: { pendingFetches: 1, pollAfterMs: 1 } });
  setup.faux.setResponses([fauxAssistantMessage("deferred answer")]);
  setup.settings.stream = { deferred: true };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);
  expect(setup.faux.state.deferredFetchCount).toBe(2);
  const pollTimes = values.flatMap((value) =>
    value.generation?.deferred === undefined ? [] : [value.generation.deferred.pollAt],
  );
  expect(pollTimes.length).toBe(2);
  expect(pollTimes[1]!).toBeGreaterThan(pollTimes[0]!);
  const answer = yield* awaited(
    root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
  );
  expect(textOf(answer?.model?.[0])).toBe("deferred answer");
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("polls a deferred response until it is ready", () => Effect.runPromise(pollsDeferredResponse));
});

const convertsCommittedPartial = Effect.gen(function* () {
  const setup = chatSetup({ tokensPerSecond: 20, tokenSize: { min: 1, max: 1 } });
  setup.faux.setResponses([fauxAssistantMessage("x".repeat(400))]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  const taskId = yield* runTask(harness, root);
  yield* waitFor(
    Effect.gen(function* () {
      return (
        textOf((yield* awaited(live(harness, root)))?.generation?.message as Message) !== undefined
      );
    }),
  );
  const partial = (yield* awaited(live(harness, root)))!.generation!.message!;
  expect(yield* awaited(harness.abortTask(taskId, context))).toBe("marked");
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  const entries = yield* allEntries(root);
  expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.assistant"]);
  const converted = entries[1]!.model![0] as AssistantMessage;
  expect(converted.stopReason).toBe("aborted");
  expect(textOf(converted)!.startsWith(textOf(partial as Message)!)).toBe(true);
  expect(yield* awaited(live(harness, root))).toEqual({});
  expect((yield* awaited(harness.waitForTask(taskId, context))).state.outcome).toEqual({
    status: "aborted",
  });
  yield* awaited(harness.close(context));
});

const cancelsDeferredResponse = Effect.gen(function* () {
  const setup = chatSetup({ deferred: { pendingFetches: 100, pollAfterMs: 60_000 } });
  setup.faux.setResponses([fauxAssistantMessage("never")]);
  setup.settings.stream = { deferred: true };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  const taskId = yield* runTask(harness, root);
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(harness, root)))?.generation?.deferred !== undefined;
    }),
  );
  yield* awaited(harness.abortTask(taskId, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(setup.faux.state.cancelledDeferred).toHaveLength(1);
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("converts the committed partial when aborted during streaming", () =>
    Effect.runPromise(convertsCommittedPartial));

  it("cancels a deferred response when aborted during polling", () =>
    Effect.runPromise(cancelsDeferredResponse));
});

const reportsFailedDeferred = Effect.gen(function* () {
  const base = chatSetup({ deferred: { pendingFetches: 100, pollAfterMs: 60_000 } });
  base.faux.setResponses([fauxAssistantMessage("never")]);
  const models = new Proxy(base.models, {
    get(target, property) {
      if (property === "cancelDeferred")
        return () => Promise.resolve(Promise.reject(new Error("cancel failed")));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const setup: ChatSetup = { ...base, models };
  setup.settings.stream = { deferred: true };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  const taskId = yield* runTask(harness, root);
  yield* waitFor(
    Effect.gen(function* () {
      return (yield* awaited(live(harness, root)))?.generation?.deferred !== undefined;
    }),
  );
  yield* awaited(harness.abortTask(taskId, context));
  expect(yield* awaited(submission.wait(context))).toMatchObject({
    status: "unanswered",
    reason: "aborted",
  });
  expect(setup.reports).toContainEqual(new Error("cancel failed"));
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("reports a failed deferred cancellation and still ends the run aborted", () =>
    Effect.runPromise(reportsFailedDeferred));
});

const forwardsStreamOptions = Effect.gen(function* () {
  const setup = chatSetup();
  const seen: (SimpleStreamOptions | undefined)[] = [];
  setup.faux.setResponses([
    (_context, options) => {
      seen.push(options);
      return fauxAssistantMessage("a");
    },
    (_context, options) => {
      seen.push(options);
      return fauxAssistantMessage("b");
    },
  ]);
  setup.settings.stream = { timeoutMs: 1234, headers: { "x-test": "1" } };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  yield* awaited(root.configure({ thinkingLevel: "high" }, context));
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "one" }, context))).wait(context),
  );
  yield* awaited(root.configure({ thinkingLevel: null }, context));
  setup.settings.stream = { timeoutMs: 99 };
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "two" }, context))).wait(context),
  );
  const sessionId = (yield* awaited(harness.snapshot(ProviderDoc, root.id, context)))!.sessionId;
  expect(seen[0]).toMatchObject({
    timeoutMs: 1234,
    headers: { "x-test": "1" },
    reasoning: "high",
    sessionId,
  });
  expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
  expect(seen[1]!.reasoning).toBeUndefined();
  expect(seen[1]).toMatchObject({ timeoutMs: 99, sessionId });
  expect(seen[1]!.headers).toBeUndefined();
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("forwards stream options and the thinking level", () =>
    Effect.runPromise(forwardsStreamOptions));
});
