import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ControlledStorage from "./controlled-storage.ts";
import harnessGenerationKit from "./harness-generation-kit.ts";
import harnessGenerationSupport from "./harness-generation-support.ts";
import harnessSupport from "./harness-support.ts";
import sessionSupport from "./session-support.ts";

const { chatSupport, effectSupport } = harnessGenerationKit;

const { fauxAssistantMessage } = ai;

const { MemoryStorage } = memory;
const { AssistantEntry } = durable;

const { allEntries, chatSetup, openChat, textOf, unanswered } = chatSupport;
const { awaited } = effectSupport;
const { ERROR_503, live, livePublications, runTask } = harnessGenerationSupport;
const { addSection } = harnessSupport;
const { context } = sessionSupport;

const answersInputSettles = Effect.gen(function* () {
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  setup.faux.setResponses([fauxAssistantMessage("Hello there")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  const settled = yield* awaited(submission.wait(context));
  if (settled.status !== "done" || settled.type !== "input")
    throw new Error(`Unexpected ${settled.status}`);

  const answer = yield* awaited(
    root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
  );
  expect(textOf(answer?.model?.[0])).toBe("Hello there");
  const entries = yield* allEntries(root);
  expect(entries.map((entry) => entry.kind)).toEqual(["msa.user", "msa.system", "msa.assistant"]);
  expect(entries[0]!.id).toBe(settled.entry);
  expect(entries[1]!.model).toEqual([
    {
      content: "",
      role: "system",
      sections: { preamble: "You are helpful." },
      timestamp: expect.any(Number),
    },
  ]);
  expect(yield* awaited(live(harness, root))).toEqual({});
  const task = (yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  )).items[0];
  expect(task?.kind).toBe("msa.generation");
  expect(entries.map((entry) => entry.byTaskId)).toEqual([undefined, task!.id, task!.id]);
  expect(task?.state).toEqual({
    outcome: { result: { entryId: settled.answer }, status: "completed" },
    status: "terminal",
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("answers an input and settles its submission", () => Effect.runPromise(answersInputSettles));
});

const storesPartialsDeltas = Effect.gen(function* () {
  const setup = chatSetup({ tokenSize: { max: 1, min: 1 }, tokensPerSecond: 200 });
  setup.faux.setResponses([fauxAssistantMessage("w".repeat(200))]);
  const storage = new ControlledStorage();
  const { harness, root } = yield* openChat(storage, setup);
  const record = yield* awaited(
    storage.findDocument(
      { kind: "msa.live", scope: { conversationId: root.id, kind: "conversation" } },
      "current",
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  const contents = storage.commits.flatMap((writes) =>
    writes.flatMap((write) =>
      write.type === "document.change" && write.id === record!.id ? [write.content.kind] : [],
    ),
  );
  expect(contents).toContain("delta");
  expect(contents.at(-1)).toBe("base");
  yield* awaited(harness.close(context));
});

const stillEndsRun = Effect.gen(function* () {
  const setup = chatSetup();
  const busy = unanswered();
  setup.faux.setResponses([busy.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const submission = yield* awaited(root.submit({ content: "hi", type: "input" }, context));
  yield* awaited(busy.reached);
  yield* awaited(
    root.commit(
      (tx) => tx.settleSubmission(submission.id, { reason: "withdrawn", status: "unanswered" }),
      context,
    ),
  );
  const taskId = yield* runTask(harness, root);
  yield* awaited(harness.abortTask(taskId, context));
  expect((yield* awaited(harness.waitForTask(taskId, context))).state.outcome).toEqual({
    status: "aborted",
  });
  expect(yield* awaited(submission.status(context))).toMatchObject({
    reason: "withdrawn",
    status: "unanswered",
  });
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("stores partials as deltas and a complete base once nothing is in flight", () =>
    Effect.runPromise(storesPartialsDeltas));

  it("still ends a run whose input something else already settled", () =>
    Effect.runPromise(stillEndsRun));
});

const failsNoModel = Effect.gen(function* () {
  const setup = chatSetup();
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const plain = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  harness.resume();
  const unset = yield* awaited(
    (yield* awaited(plain.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  expect(unset).toMatchObject({ reason: "no_model", status: "unanswered" });

  yield* awaited(root.configure({ model: { modelId: "missing", provider: "faux" } }, context));
  const unknown = yield* awaited(
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  expect(unknown).toMatchObject({
    entry: expect.any(Number),
    reason: "no_model",
    status: "unanswered",
  });
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual(["msa.user"]);
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items[0]!.state).toEqual({
    outcome: {
      error: {
        detail: { reason: "no_model" },
        message: "Model faux/missing is not available",
      },
      status: "failed",
    },
    status: "terminal",
  });
  expect(yield* awaited(live(harness, root))).toEqual({});
  expect(yield* awaited(live(harness, plain))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("fails with no_model when no model is configured or the model is unknown", () =>
    Effect.runPromise(failsNoModel));
});

const retriesRetryableError = Effect.gen(function* () {
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "p", { tag: false });
  setup.faux.setResponses([ERROR_503, fauxAssistantMessage("recovered")]);
  setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 3 };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  expect(settled.status).toBe("done");
  const entries = yield* allEntries(root);
  expect(entries.map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.assistant",
  ]);
  expect((entries[2]!.model![0] as aiTypes.AssistantMessage).stopReason).toBe("error");
  expect(values.some((value) => value.generation?.retry?.error === "503 Service Unavailable")).toBe(
    true,
  );
  expect(values.some((value) => value.generation?.attempt === 2)).toBe(true);
  expect(yield* awaited(live(harness, root))).toEqual({});
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("retries a retryable error after a durable backoff and then answers", () =>
    Effect.runPromise(retriesRetryableError));
});

const failsModelError = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([ERROR_503, ERROR_503, fauxAssistantMessage("never")]);
  setup.settings.retry = { baseDelayMs: 1, enabled: true, maxRetries: 1 };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  expect(settled).toMatchObject({
    detail: "503 Service Unavailable",
    reason: "model_error",
    status: "unanswered",
  });
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
    "msa.assistant",
  ]);
  expect(setup.faux.getPendingResponseCount()).toBe(1);
  yield* awaited(harness.close(context));
});

const failsRetryableError = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([ERROR_503, fauxAssistantMessage("never")]);
  setup.settings.retry = { enabled: false };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ content: "hi", type: "input" }, context))).wait(context),
  );
  expect(settled).toMatchObject({ reason: "model_error", status: "unanswered" });
  expect(setup.faux.state.callCount).toBe(1);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("fails with model_error once retries are exhausted", () => Effect.runPromise(failsModelError));

  it("fails a retryable error without retrying when the retry policy is disabled", () =>
    Effect.runPromise(failsRetryableError));
});
