import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import modelResolver from "../../../src/core/model-resolver.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";
import CredentialRefreshHangSupport from "./7027-credential-refresh-hang-support.ts";

const { defaultModelPerProvider } = modelResolver;

const { complete } = CredentialRefreshHangSupport;

const { createHarness } = harnessModule;

const { deferredPromise } = testing;

let harness3!: harnessTypes.Harness;

const startLoginPart1 = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    harness3 = yield* Effect.promise(() => createHarness());
    vi.useFakeTimers();
    const session = harness3.session;
    const model = harness3.getModel();
    const unknownModel = { ...model, api: "unknown", id: "unknown", provider: "unknown" };
    const currentModel = vi.spyOn(session, "model", "get").mockReturnValue(unknownModel);
    const availableModels = vi
      .spyOn(session.modelRuntime, "getAvailableSnapshot")
      .mockReturnValue([]);
    return { availableModels, currentModel, model, runPromise, session, unknownModel };
  });

const holdRefresh = (session: harnessTypes.Harness["session"]) => {
  const finisher = { finish: () => {} };
  vi.spyOn(session.modelRuntime, "refresh").mockImplementation((options) => {
    const refresh = deferredPromise<{ aborted: boolean; errors: Map<string, string> }>();
    finisher.finish = () => refresh.resolve({ aborted: false, errors: new Map() });
    options?.signal?.addEventListener(
      "abort",
      () => refresh.resolve({ aborted: true, errors: new Map() }),
      { once: true },
    );
    return refresh.promise as unknown as ReturnType<typeof session.modelRuntime.refresh>;
  });
  return () => finisher.finish();
};

function startLogin() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const { availableModels, currentModel, model, runPromise, session, unknownModel } =
        yield* startLoginPart1();
      const finishRefresh = holdRefresh(session);
      const setModel = vi.spyOn(session, "setModel").mockResolvedValue();
      const context = {
        refreshAuthState: vi.fn(),
        session,
        showError: vi.fn(),
        showStatus: vi.fn(),
        showWarning: vi.fn(),
        ui: { requestRender: vi.fn() },
      };
      yield* Effect.promise(() =>
        complete(context, "openrouter", "OpenRouter", "oauth", unknownModel),
      );
      expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Credentials saved"));
      expect(context.showError).not.toHaveBeenCalled();
      expect(setModel).not.toHaveBeenCalled();

      return {
        ...context,
        currentModel,
        discover(ids: string[]) {
          return runPromise(
            Effect.gen(function* () {
              availableModels.mockReturnValue(
                ids.map((id) => ({ ...model, id, provider: "openrouter" })),
              );
              finishRefresh();
              yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
            }),
          );
        },
        setModel,
      };
    }),
  );
}

const selectsTheDefaultModelFromThe = Effect.gen(function* () {
  const selected = defaultModelPerProvider.openrouter!;
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover(["fast", selected]));
  expect(login.setModel).toHaveBeenCalledWith(
    expect.objectContaining({ id: selected, provider: "openrouter" }),
    {
      persist: true,
    },
  );
  expect(login.showError).not.toHaveBeenCalled();
});

const reportsARefreshedCatalogWithoutThe = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover(["fast", "powerful"]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("is not available"));
});

const reportsAnEmptyCatalogOnlyAfter = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => login.discover([]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("no models are available"));
});

const preservesAModelSelectedDuringRefresh = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  login.currentModel.mockReturnValue(harness3!.getModel());
  yield* Effect.promise(() => login.discover(["fast", "balanced"]));
  expect(login.setModel).not.toHaveBeenCalled();
  expect(login.showError).not.toHaveBeenCalled();
});

const boundsRefreshTo15Seconds = Effect.gen(function* () {
  const login = yield* Effect.promise(() => startLogin());
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(15_000));
  expect(login.showWarning).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  expect(login.showError).toHaveBeenCalledWith(expect.stringContaining("no models are available"));
  expect(login.setModel).not.toHaveBeenCalled();
});

const selectsTheDefaultModelFromTheRefreshed = () =>
  Effect.runPromise(selectsTheDefaultModelFromThe);

const reportsARefreshedCatalogWithoutTheDefault = () =>
  Effect.runPromise(reportsARefreshedCatalogWithoutThe);

const reportsAnEmptyCatalogOnlyAfterRefresh = () =>
  Effect.runPromise(reportsAnEmptyCatalogOnlyAfter);

const preservesAModelSelectedDuringRefresh2 = () =>
  Effect.runPromise(preservesAModelSelectedDuringRefresh);

const boundsRefreshTo15Seconds2 = () => Effect.runPromise(boundsRefreshTo15Seconds);

const afterEachHook2 = () => {
  vi.useRealTimers();
  harness3?.cleanup();
  vi.restoreAllMocks();
};

describe("post-login model discovery", () => {
  afterEach(afterEachHook2);
  it(
    "selects the default model from the refreshed catalog",
    selectsTheDefaultModelFromTheRefreshed,
  );
  it(
    "reports a refreshed catalog without the default model",
    reportsARefreshedCatalogWithoutTheDefault,
  );
  it("reports an empty catalog only after refresh", reportsAnEmptyCatalogOnlyAfterRefresh);
  it("preserves a model selected during refresh", preservesAModelSelectedDuringRefresh2);
  it("bounds refresh to 15 seconds", boundsRefreshTo15Seconds2);
});
