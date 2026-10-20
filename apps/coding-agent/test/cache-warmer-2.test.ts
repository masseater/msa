import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import cacheWarmerSupport from "./cache-warmer-support.ts";

const { branchWithPrompt, current, fakeRuntime, request } = cacheWarmerSupport;

const { awaited, runTest } = testing;

afterEach(() => vi.useRealTimers());

const doesNotIssueRefreshesAfterTheirSafe = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const { warmer, calls } = fakeRuntime();
      warmer.start(request(), current);

      vi.setSystemTime(285_001);
      vi.clearAllTimers();
      const internal = warmer as unknown as {
        run: object | undefined;
        refresh: (run: object) => Promise<void>;
      };
      if (!(internal.run !== undefined)) throw new Error("expected an active cache-warming run");
      yield* awaited(internal.refresh(internal.run));

      expect(calls).toHaveLength(0);
      expect(warmer.status).toMatchObject({
        reason: "cache refresh deadline missed",
        state: "inactive",
      });
    }),
  );

const rechecksTheDeadlineAfterAnExtensionDecision = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      vi.useFakeTimers();
      vi.setSystemTime(0);
      const { warmer, calls } = fakeRuntime({
        decide: () =>
          effectRunPromise(
            Effect.gen(function* () {
              yield* awaited(Promise.resolve());
              vi.setSystemTime(285_001);
              return yield* awaited("warm" as const);
            }),
          ),
      });
      warmer.start(request(), current);
      vi.clearAllTimers();
      const internal = warmer as unknown as {
        run: object | undefined;
        refresh: (run: object) => Promise<void>;
      };
      if (!(internal.run !== undefined)) throw new Error("expected an active cache-warming run");
      yield* awaited(internal.refresh(internal.run));

      expect(calls).toHaveLength(0);
      expect(warmer.status).toMatchObject({
        reason: "cache refresh deadline missed",
        state: "inactive",
      });
    }),
  );

describe("cache warming", () => {
  it("does not issue refreshes after their safe deadline", doesNotIssueRefreshesAfterTheirSafe);

  it(
    "rechecks the deadline after an extension decision",
    rechecksTheDeadlineAfterAnExtensionDecision,
  );
});

const appliesEconomicDecisionsAndExtensionOverrides = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const unprofitable = fakeRuntime({ branch: branchWithPrompt(5_000) });
      unprofitable.warmer.start(request(), current);
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(unprofitable.calls).toHaveLength(0);
      expect(unprofitable.warmer.status).toMatchObject({
        decision: { action: "stop", economicsAvailable: true },
        extensionOverride: false,
        state: "inactive",
      });

      const forced = fakeRuntime({ branch: branchWithPrompt(5_000), decide: () => "warm" });
      forced.warmer.start(request(), current);
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(forced.calls).toHaveLength(1);
      expect(forced.warmedEntries[0]?.note).toBe("extension override");
      forced.warmer.cancel();

      const vetoed = fakeRuntime({ decide: () => "stop" });
      vetoed.warmer.start(request(), current);
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(vetoed.calls).toHaveLength(0);
      expect(vetoed.warmer.status).toMatchObject({ extensionOverride: true, state: "inactive" });

      const unavailable = fakeRuntime({ branch: branchWithPrompt(0) });
      unavailable.warmer.start(request(), current);
      expect(unavailable.warmer.status).toMatchObject({
        reason: "cache economics unavailable",
        state: "inactive",
      });
      yield* awaited(vi.advanceTimersByTimeAsync(270_000));
      expect(unavailable.calls).toHaveLength(0);
    }),
  );

describe("cache warming", () => {
  it(
    "applies economic decisions and extension overrides",
    appliesEconomicDecisionsAndExtensionOverrides,
  );
});
