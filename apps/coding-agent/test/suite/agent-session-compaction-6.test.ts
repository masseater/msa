import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionCompactionSupport from "./agent-session-compaction-support.ts";
import type agentSessionCompactionSupportTypes from "./agent-session-compaction-support.types.ts";
import harnessModule from "./harness.ts";

const { createAssistant, harnesses } = agentSessionCompactionSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const doesNotTriggerThresholdCompactionBelow = Effect.gen(function* () {
  const belowThresholdHarness = yield* Effect.promise(() =>
    createHarness({
      models: [{ contextWindow: 200_000, id: "faux-1" }],
      settings: { compaction: { enabled: true, reserveTokens: 1000 } },
    }),
  );
  harnesses.push(belowThresholdHarness);
  const disabledHarness = yield* Effect.promise(() =>
    createHarness({ settings: { compaction: { enabled: false } } }),
  );
  harnesses.push(disabledHarness);

  const belowThresholdInternals =
    belowThresholdHarness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const disabledInternals =
    disabledHarness.session as unknown as agentSessionCompactionSupportTypes.SessionWithCompactionInternals;
  const belowThresholdSpy = vi
    .spyOn(belowThresholdInternals, "runAutoCompaction")
    .mockResolvedValue(false);
  const disabledSpy = vi.spyOn(disabledInternals, "runAutoCompaction").mockResolvedValue(false);

  yield* Effect.promise(() =>
    belowThresholdInternals["checkCompaction"](
      createAssistant(belowThresholdHarness, {
        stopReason: "stop",
        timestamp: currentTimeMillis(),
        totalTokens: 1_000,
      }),
    ),
  );
  yield* Effect.promise(() =>
    disabledInternals["checkCompaction"](
      createAssistant(disabledHarness, {
        stopReason: "stop",
        timestamp: currentTimeMillis(),
        totalTokens: 1_000_000,
      }),
    ),
  );

  expect(belowThresholdSpy).not.toHaveBeenCalled();
  expect(disabledSpy).not.toHaveBeenCalled();
});

const doesNotTriggerThresholdCompactionBelowThe = () =>
  Effect.runPromise(doesNotTriggerThresholdCompactionBelow);

const afterEachHook6 = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession compaction characterization", () => {
  afterEach(afterEachHook6);

  it(
    "does not trigger threshold compaction below the threshold or when disabled",
    doesNotTriggerThresholdCompactionBelowThe,
  );
});
