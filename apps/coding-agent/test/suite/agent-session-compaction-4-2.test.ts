import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompaction4Support from "./agent-session-compaction-4-support.ts";
import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import type agentSessionCompactionSupportTypes from "./agent-session-compaction-support.types.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage } = ai;

const { afterEachHook4 } = agentSessionCompaction4Support;

const { createAssistant, harnesses, seedCompactableSession } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis, deferredPromise, gate } = testing;

function createAbortableCompactionHarness(): Promise<{
  harness: harnessTypes.Harness;
  compactionStarted: Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const compactionStarted = gate();
      const harness = yield* Effect.promise(() =>
        createHarness({
          extensionFactories: [
            (msa) => {
              msa.on("session_before_compact", (event) => {
                const cancelled = deferredPromise<{ cancel: true }>();
                event.signal.addEventListener("abort", () => cancelled.resolve({ cancel: true }), {
                  once: true,
                });
                compactionStarted.release();
                return cancelled.promise;
              });
            },
          ],
          settings: { compaction: { keepRecentTokens: 1 } },
        }),
      );
      seedCompactableSession(harness);
      return { compactionStarted, harness };
    }),
  );
}

const stopsAfterOneCompactAndRetry = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "overflow compacted",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      models: [{ contextWindow: 1_000_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  return yield* stopsAfterOneCompactAndRetryStep1(harness);
});

const stopsAfterOneCompactAndRetryStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      () =>
        fauxAssistantMessage("x".repeat(64), {
          stopReason: "length",
          timestamp: currentTimeMillis() + 10_000,
        }),
      () =>
        fauxAssistantMessage("y".repeat(64), {
          stopReason: "length",
          timestamp: currentTimeMillis() + 10_000,
        }),
    ]);
    yield* Effect.promise(() => harness.session.prompt("x".repeat(5000)));
    expect(harness.faux.state.callCount).toBe(2);
    expect(
      harness.eventsOfType("compaction_start").filter((event) => event.reason === "overflow"),
    ).toHaveLength(1);
    expect(harness.eventsOfType("compaction_end").at(-1)?.errorMessage).toBe(
      "Truncated response recovery failed after one compact-and-retry attempt.",
    );
  });

const keepsOverflowWordingWhenARepeated = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ contextWindow: 100, id: "faux-1", maxTokens: 100 }],
    }),
  );
  harnesses.push(harness);
  const sessionInternals =
    harness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const lengthOverflowMessage = createAssistant(harness, {
    stopReason: "length",
    timestamp: currentTimeMillis(),
    totalTokens: 100,
  });
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);
  const compactionErrors: string[] = [];
  harness.session.subscribe((event) => {
    if (
      event.type === "compaction_end" &&
      event.errorMessage !== undefined &&
      event.errorMessage !== ""
    ) {
      compactionErrors.push(event.errorMessage);
    }
  });

  yield* Effect.promise(() => sessionInternals["checkCompaction"](lengthOverflowMessage));
  yield* Effect.promise(() =>
    sessionInternals["checkCompaction"]({
      ...lengthOverflowMessage,
      timestamp: currentTimeMillis() + 1,
    }),
  );

  expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
  expect(compactionErrors).toContain(
    "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
  );
});

const cancelsInProgressManualCompactionWhen = Effect.gen(function* () {
  const { harness, compactionStarted } = yield* Effect.promise(() =>
    createAbortableCompactionHarness(),
  );
  harnesses.push(harness);

  const compactPromise = harness.session.compact();
  const compactExpectation = expect(compactPromise).rejects.toThrow("Compaction cancelled");
  yield* Effect.promise(() => compactionStarted);
  harness.session.abortCompaction();

  yield* Effect.promise(() => compactExpectation);
});

const abortsAnInProgressManualCompaction = Effect.gen(function* () {
  const { harness, compactionStarted } = yield* Effect.promise(() =>
    createAbortableCompactionHarness(),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("continued")]);

  const compactPromise = harness.session.compact();
  const compactExpectation = expect(compactPromise).rejects.toThrow("Compaction cancelled");
  yield* Effect.promise(() => compactionStarted);
  yield* Effect.promise(() => harness.session.abort());
  yield* Effect.promise(() => compactExpectation);

  expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
    aborted: true,
    reason: "manual",
  });
  expect(harness.session.isCompacting).toBe(false);
  expect(harness.session.isIdle).toBe(true);

  yield* Effect.promise(() =>
    expect(harness.session.prompt("next prompt")).resolves.toBeUndefined(),
  );
  expect(harness.session.getLastAssistantText()).toBe("continued");
});

const stopsAfterOneCompactAndRetryWhen = () => Effect.runPromise(stopsAfterOneCompactAndRetry);

const keepsOverflowWordingWhenARepeatedLength = () =>
  Effect.runPromise(keepsOverflowWordingWhenARepeated);

const cancelsInProgressManualCompactionWhenAbortcompaction = () =>
  Effect.runPromise(cancelsInProgressManualCompactionWhen);

const abortsAnInProgressManualCompactionAnd = () =>
  Effect.runPromise(abortsAnInProgressManualCompaction);

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook4);

  it(
    "stops after one compact-and-retry when a second response is also truncated",
    stopsAfterOneCompactAndRetryWhen,
  );

  it(
    "keeps overflow wording when a repeated length stop fills the context window",
    keepsOverflowWordingWhenARepeatedLength,
  );

  it(
    "cancels in-progress manual compaction when abortCompaction is called",
    cancelsInProgressManualCompactionWhenAbortcompaction,
  );
});

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook4);

  it(
    "aborts an in-progress manual compaction and waits until the session is idle",
    abortsAnInProgressManualCompactionAnd,
  );
});
