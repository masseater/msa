import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const { neverPromise } = testing;

const findExactModelMatch = Reflect.get(InteractiveMode.prototype, "findExactModelMatch") as (
  this: object,
  searchTerm: string,
) => Promise<aiTypes.Model<aiTypes.Api> | undefined>;

let harness!: harnessTypes.Harness;

const matchesTheAvailabilitySnapshotWithoutStarting = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = vi
    .spyOn(harness.session.modelRuntime, "refresh")
    .mockImplementation(() => neverPromise());
  const context = { session: harness.session, showStatus: vi.fn(), showWarning: vi.fn() };

  const model = yield* Effect.promise(() =>
    findExactModelMatch.call(context, harness.models[0].id),
  );

  expect(model?.id).toBe("cached");
  expect(refresh).not.toHaveBeenCalled();
  expect(context.showStatus).not.toHaveBeenCalled();
});

const usesACallerOwnedDeadlineOnly = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
    aborted: true,
    errors: new Map(),
  });
  const context = { session: harness.session, showStatus: vi.fn(), showWarning: vi.fn() };

  yield* Effect.promise(() =>
    expect(findExactModelMatch.call(context, "not-cached")).resolves.toBeUndefined(),
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
    harness?.cleanup();
    vi.restoreAllMocks();
  });
  it(
    "matches the availability snapshot without starting a catalog refresh",
    matchesTheAvailabilitySnapshotWithoutStartingA,
  );
  it("uses a caller-owned deadline only after a cache miss", usesACallerOwnedDeadlineOnlyAfter);
});
