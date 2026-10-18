import type { Api, Model } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness } from "../harness.ts";

const findExactModelMatch = Reflect.get(InteractiveMode.prototype, "findExactModelMatch") as (
  this: object,
  searchTerm: string,
) => Promise<Model<Api> | undefined>;

let harness!: Harness;

const matchesTheAvailabilitySnapshotWithoutStarting = Effect.gen(function* () {
  harness = yield* Effect.promise(() =>
    createHarness({ models: [{ id: "cached", name: "Cached" }] }),
  );
  const refresh = vi
    .spyOn(harness.session.modelRuntime, "refresh")
    .mockImplementation(() => new Promise(() => {}));
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

describe("issue #7443 /model cached match", () => {
  afterEach(() => {
    harness?.cleanup();
    vi.restoreAllMocks();
  });
  it("matches the availability snapshot without starting a catalog refresh", () =>
    Effect.runPromise(matchesTheAvailabilitySnapshotWithoutStarting));
  it("uses a caller-owned deadline only after a cache miss", () =>
    Effect.runPromise(usesACallerOwnedDeadlineOnly));
});
