import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createHarness, type Harness } from "../harness.ts";

type SessionWithCompactionInternals = {
  _runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function seedCompactableSession(harness: Harness): void {
  const model = harness.getModel();
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "x".repeat(500) }],
    timestamp: 1,
  });
  const assistant: AssistantMessage = {
    ...fauxAssistantMessage("y".repeat(200), { timestamp: 2 }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function runAutoCompaction(harness: Harness): Promise<boolean> {
  return (harness.session as unknown as SessionWithCompactionInternals)["_runAutoCompaction"](
    "threshold",
    false,
  );
}

const harnesses: Harness[] = [];

const doesNotStartPostRunAuto = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "faux-1", contextWindow: 200, maxTokens: 50 }],
      settings: {
        compaction: { enabled: true, reserveTokens: 50, keepRecentTokens: 1 },
        retry: { enabled: false },
      },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);
  harness.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "Synthetic network failure",
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
  let markAuthStarted = () => {};
  const authStarted = new Promise<void>((resolve) => {
    markAuthStarted = resolve;
  });
  let authSignal: AbortSignal | undefined;
  vi.spyOn(harness.session.modelRuntime, "getAuth").mockImplementation((_model, options) =>
    runPromise(
      Effect.gen(function* () {
        authSignal = options?.signal;
        markAuthStarted();
        if (authSignal === undefined) throw new Error("Missing auth abort signal");
        return yield* Effect.promise(
          () =>
            new Promise<never>((_resolve, reject) => {
              authSignal?.addEventListener("abort", () => reject(authSignal?.reason), {
                once: true,
              });
            }),
        );
      }),
    ),
  );

  const compaction = runAutoCompaction(harness);
  yield* Effect.promise(() => authStarted);
  const started = harness.eventsOfType("compaction_start").length;
  const wasCompacting = harness.session.isCompacting;
  yield* Effect.promise(() => Promise.all([compaction, harness.session.abort()]));

  expect({ started, wasCompacting, authAborted: authSignal?.aborted }).toEqual({
    started: 1,
    wasCompacting: true,
    authAborted: true,
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
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", () => ({ cancel: true }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  seedCompactableSession(harness);

  yield* Effect.promise(() => runAutoCompaction(harness));

  expect(harness.eventsOfType("compaction_end").at(-1)?.aborted).toBe(true);
});

describe("automatic compaction cancellation regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });
  it("does not start post-run auto-compaction after abort", () =>
    Effect.runPromise(doesNotStartPostRunAuto));
  it("cancels summarization authentication", () =>
    Effect.runPromise(cancelsSummarizationAuthentication));
  it("cancels synchronously from compaction_start", () =>
    Effect.runPromise(cancelsSynchronouslyFromCompactionStart));
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
  it("reports extension cancellation as aborted", () =>
    Effect.runPromise(reportsExtensionCancellationAsAborted));
});
