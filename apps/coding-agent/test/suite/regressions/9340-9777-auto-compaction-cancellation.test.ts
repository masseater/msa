import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const { deferredPromise, gate } = testing;

type SessionWithCompactionInternals = {
  runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function seedCompactableSession(harness: harnessTypes.Harness): void {
  const model = harness.getModel();
  harness.sessionManager.appendMessage({
    content: [{ text: "x".repeat(500), type: "text" }],
    role: "user",
    timestamp: 1,
  });
  const assistant: AssistantMessage = {
    ...fauxAssistantMessage("y".repeat(200), { timestamp: 2 }),
    api: model.api,
    model: model.id,
    provider: model.provider,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 100,
      output: 0,
      totalTokens: 100,
    },
  };
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function runAutoCompaction(harness: harnessTypes.Harness): Promise<boolean> {
  return (harness.session as unknown as SessionWithCompactionInternals)["runAutoCompaction"](
    "threshold",
    false,
  );
}

const harnesses: harnessTypes.Harness[] = [];

const doesNotStartPostRunAuto = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
      models: [{ contextWindow: 200, id: "faux-1", maxTokens: 50 }],
      settings: {
        compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 50 },
        retry: { enabled: false },
      },
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.setResponses([
    fauxAssistantMessage("", {
      errorMessage: "Synthetic network failure",
      stopReason: "error",
    }),
  ]);
  harness.session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      harness.session.abortCompaction();
      void harness.session.abort();
    }
  });

  yield* Effect.promise(() => harness.session.prompt("z".repeat(1000)));

  expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
});

const cancelsSummarizationAuthentication = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { compaction: { keepRecentTokens: 1 } } }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  const authStarted = gate();
  let authSignal: AbortSignal | undefined;
  vi.spyOn(harness.session.modelRuntime, "getAuth").mockImplementation((_model, options) =>
    runPromise(
      Effect.gen(function* () {
        authSignal = options?.signal;
        authStarted.release();
        if (authSignal === undefined) throw new Error("Missing auth abort signal");
        const aborted = deferredPromise<never>();
        const signal = authSignal;
        signal.addEventListener("abort", () => aborted.reject(signal.reason), { once: true });
        return yield* Effect.promise(() => aborted.promise);
      }),
    ),
  );

  const compaction = runAutoCompaction(harness);
  yield* Effect.promise(() => authStarted);
  const started = harness.eventsOfType("compaction_start").length;
  const wasCompacting = harness.session.isCompacting;
  yield* Effect.promise(() => Promise.all([compaction, harness.session.abort()]));

  expect({ authAborted: authSignal?.aborted, started, wasCompacting }).toEqual({
    authAborted: true,
    started: 1,
    wasCompacting: true,
  });
  expect(harness.eventsOfType("compaction_end").at(-1)?.aborted).toBe(true);
});

const cancelsSynchronouslyFromCompactionStart = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ settings: { compaction: { keepRecentTokens: 1 } } }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.session.subscribe((event) => {
    if (event.type === "compaction_start") harness.session.abortCompaction();
  });

  yield* Effect.promise(() => runAutoCompaction(harness));

  expect(harness.faux.state.callCount).toBe(0);
  expect(harness.eventsOfType("compaction_end").at(-1)?.aborted).toBe(true);
});

const reportsExtensionCancellationAsAborted = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
      settings: { compaction: { keepRecentTokens: 1 } },
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);

  yield* Effect.promise(() => runAutoCompaction(harness));

  expect(harness.eventsOfType("compaction_end").at(-1)?.aborted).toBe(true);
});

const doesNotStartPostRunAutoCompaction = () => Effect.runPromise(doesNotStartPostRunAuto);

const cancelsSummarizationAuthentication2 = () =>
  Effect.runPromise(cancelsSummarizationAuthentication);

const cancelsSynchronouslyFromCompactionStart2 = () =>
  Effect.runPromise(cancelsSynchronouslyFromCompactionStart);

const reportsExtensionCancellationAsAborted2 = () =>
  Effect.runPromise(reportsExtensionCancellationAsAborted);

describe("automatic compaction cancellation regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("does not start post-run auto-compaction after abort", doesNotStartPostRunAutoCompaction);
  it("cancels summarization authentication", cancelsSummarizationAuthentication2);
  it("cancels synchronously from compaction_start", cancelsSynchronouslyFromCompactionStart2);
  it.each([
    ["matching error text", () => new Error("Compaction cancelled")],
    [
      "an unrelated AbortError",
      () => Object.assign(new Error("auth failed"), { name: "AbortError" }),
    ],
  ] as const)("reports %s as a failure", (_label, createError) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({ settings: { compaction: { keepRecentTokens: 1 } } }),
        );
        harnesses.push(harness);
        seedCompactableSession(harness);
        vi.spyOn(harness.session.modelRuntime, "getAuth").mockRejectedValue(createError());

        yield* Effect.promise(() => runAutoCompaction(harness));

        const event = harness.eventsOfType("compaction_end").at(-1);
        expect(event?.aborted).toBe(false);
        expect(event?.errorMessage).toContain(createError().message);
      }),
    ),
  );
  it("reports extension cancellation as aborted", reportsExtensionCancellationAsAborted2);
});
