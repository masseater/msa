import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import interactiveModeFake from "../../interactive-mode-fake.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { bindModeFake } = interactiveModeFake;
const { createHarness } = harnessModule;

const { awaited, neverPromise, runTest } = testing;
let harness!: harnessTypes.Harness;

const matchesTheAvailabilitySnapshotWithoutStarting = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = vi
    .spyOn(harness.session.models.selection.modelRuntime, "refresh")
    .mockImplementation(() => neverPromise());
  const context = { session: harness.session, showStatus: vi.fn(), showWarning: vi.fn() };

  const model = yield* Effect.promise(() =>
    bindModeFake(context).models.selector.findExactModelMatch(harness.models[0].id),
  );

  expect(model?.id).toBe("cached");
  expect(refresh).not.toHaveBeenCalled();
  expect(context.showStatus).not.toHaveBeenCalled();
});

const usesACallerOwnedDeadlineOnly = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = vi
    .spyOn(harness.session.models.selection.modelRuntime, "refresh")
    .mockResolvedValue({
      aborted: true,
      errors: new Map(),
    });
  const context = { session: harness.session, showStatus: vi.fn(), showWarning: vi.fn() };

  yield* Effect.promise(() =>
    expect(
      bindModeFake(context).models.selector.findExactModelMatch("not-cached"),
    ).resolves.toBeUndefined(),
  );

  expect(refresh).toHaveBeenCalledOnce();
  expect(refresh.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(context.showStatus).toHaveBeenCalledWith("Refreshing model catalogs…");
});

const matchesTheAvailabilitySnapshotWithoutStartingA = () =>
  Effect.runPromise(matchesTheAvailabilitySnapshotWithoutStarting);

const usesACallerOwnedDeadlineOnlyAfter = () => Effect.runPromise(usesACallerOwnedDeadlineOnly);

describe("issue #7443 /model cached match", () => {
  afterEach(() => {
    const closing = harness?.cleanup();
    return runTest(awaited(closing).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks()))));
  });
  it(
    "matches the availability snapshot without starting a catalog refresh",
    matchesTheAvailabilitySnapshotWithoutStartingA,
  );
  it("uses a caller-owned deadline only after a cache miss", usesACallerOwnedDeadlineOnlyAfter);
});
