import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { AssistantEntry, defineExtension, wrapSection } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { allEntries, chatSetup, openChat, textOf, unanswered } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { livePublications, ERROR_503, runTask, live } from "./harness-generation-support.ts";
import { addSection } from "./harness-support.ts";
import { ControlledStorage, context } from "./session-support.ts";

const answersInputSettles = Effect.gen(function* () {
  const setup = chatSetup();
  addSection(setup.registry, "preamble", () => "You are helpful.", { tag: false });
  setup.faux.setResponses([fauxAssistantMessage("Hello there")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
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
      role: "system",
      content: "",
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
    status: "terminal",
    outcome: { status: "completed", result: { entryId: settled.answer } },
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("answers an input and settles its submission", () => Effect.runPromise(answersInputSettles));
});

const storesPartialsDeltas = Effect.gen(function* () {
  const setup = chatSetup({ tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } });
  setup.faux.setResponses([fauxAssistantMessage("w".repeat(200))]);
  const storage = new ControlledStorage();
  const { harness, root } = yield* openChat(storage, setup);
  const record = yield* awaited(
    storage.findDocument(
      { kind: "msa.live", scope: { kind: "conversation", conversationId: root.id } },
      "current",
      context,
    ),
  );
  harness.resume();
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
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
  const submission = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* awaited(busy.reached);
  yield* awaited(
    root.commit(
      (tx) => tx.settleSubmission(submission.id, { status: "unanswered", reason: "withdrawn" }),
      context,
    ),
  );
  const taskId = yield* runTask(harness, root);
  yield* awaited(harness.abortTask(taskId, context));
  expect((yield* awaited(harness.waitForTask(taskId, context))).state.outcome).toEqual({
    status: "aborted",
  });
  expect(yield* awaited(submission.status(context))).toMatchObject({
    status: "unanswered",
    reason: "withdrawn",
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
    (yield* awaited(plain.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(unset).toMatchObject({ status: "unanswered", reason: "no_model" });

  yield* awaited(root.configure({ model: { provider: "faux", modelId: "missing" } }, context));
  const unknown = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(unknown).toMatchObject({
    status: "unanswered",
    reason: "no_model",
    entry: expect.any(Number),
  });
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual(["msa.user"]);
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items[0]!.state).toEqual({
    status: "terminal",
    outcome: {
      status: "failed",
      error: {
        message: "Model faux/missing is not available",
        detail: { reason: "no_model" },
      },
    },
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
  setup.settings.retry = { enabled: true, maxRetries: 3, baseDelayMs: 1 };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const values = livePublications(harness);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(settled.status).toBe("done");
  const entries = yield* allEntries(root);
  expect(entries.map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.system",
    "msa.assistant",
    "msa.assistant",
  ]);
  expect((entries[2]!.model![0] as AssistantMessage).stopReason).toBe("error");
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
  setup.settings.retry = { enabled: true, maxRetries: 1, baseDelayMs: 1 };
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(settled).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "503 Service Unavailable",
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
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(settled).toMatchObject({ status: "unanswered", reason: "model_error" });
  expect(setup.faux.state.callCount).toBe(1);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("fails with model_error once retries are exhausted", () => Effect.runPromise(failsModelError));

  it("fails a retryable error without retrying when the retry policy is disabled", () =>
    Effect.runPromise(failsRetryableError));
});

const reportsSectionWrapper = Effect.gen(function* () {
  const setup = chatSetup();
  addSection(setup.registry, "cwd", () => "/repo");
  setup.registry.install(
    defineExtension({
      name: "broken",
      wraps: [
        wrapSection("cwd", () => {
          throw new Error("wrapper failed");
        }),
      ],
    }),
  );
  setup.faux.setResponses([fauxAssistantMessage("ok")]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  expect(
    (yield* awaited(
      (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
    )).status,
  ).toBe("done");
  expect(setup.reports).toContainEqual(new Error("wrapper failed"));
  expect((yield* allEntries(root)).map((entry) => entry.kind)).toEqual([
    "msa.user",
    "msa.assistant",
  ]);
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("reports section wrapper failures while preparing", () =>
    Effect.runPromise(reportsSectionWrapper));
});

const failsNonRetryable = Effect.gen(function* () {
  const setup = chatSetup();
  setup.faux.setResponses([
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "Invalid request" }),
    fauxAssistantMessage("never"),
  ]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  harness.resume();
  const settled = yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "hi" }, context))).wait(context),
  );
  expect(settled).toMatchObject({
    status: "unanswered",
    reason: "model_error",
    detail: "Invalid request",
  });
  const tasks = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ conversationId: root.id }, 10), context),
  );
  expect(tasks.items[0]!.state).toMatchObject({
    outcome: {
      status: "failed",
      error: { message: "Invalid request", detail: { reason: "model_error" } },
    },
  });
  yield* awaited(harness.close(context));
});

describe("generation", () => {
  it("fails a non-retryable error without retrying", () => Effect.runPromise(failsNonRetryable));
});
