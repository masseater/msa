import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import interactiveModeFake from "../../interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { gate } = testing;

type RebindContext = {
  session: object;
  unsubscribe?: () => void;
  applyRuntimeSettings: () => void;
  programStatus: { reset(): void };
  renderCurrentSessionState: () => void;
  bindCurrentSessionExtensions: () => Promise<void>;
  subscribeToAgent: () => void;
  updateAvailableProviderCount: () => Promise<void>;
  updateEditorBorderColor: () => void;
  updateTerminalTitle: () => void;
};
const doesNotSubscribeFromTheStale = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const startupSession = {};
  const replacementSession = {};

  const startupBind = gate();
  const replacementBind = gate();

  const subscribeToAgent = vi.fn();
  const updateTerminalTitle = vi.fn();
  let bindCount = 0;

  const context: RebindContext = {
    applyRuntimeSettings: () => {},
    bindCurrentSessionExtensions: () => {
      bindCount += 1;
      return bindCount === 1 ? startupBind : replacementBind;
    },
    programStatus: { reset: () => {} },
    renderCurrentSessionState: () => {},
    session: startupSession,
    subscribeToAgent,
    updateAvailableProviderCount: () => runPromise(Effect.sync(() => {})),
    updateEditorBorderColor: () => {},
    updateTerminalTitle,
  };

  const startupRebind = bindModeFake(context).extensions.binding.rebindCurrentSession();
  expect(bindCount).toBe(1);

  context.session = replacementSession;
  const replacementRebind = bindModeFake(context).extensions.binding.rebindCurrentSession({
    renderBeforeBind: true,
  });

  expect(bindCount).toBe(2);
  expect(subscribeToAgent).toHaveBeenCalledTimes(1);

  startupBind.release();
  yield* Effect.promise(() => startupRebind);

  expect(subscribeToAgent).toHaveBeenCalledTimes(1);
  expect(updateTerminalTitle).not.toHaveBeenCalled();

  replacementBind.release();
  yield* Effect.promise(() => replacementRebind);

  expect(subscribeToAgent).toHaveBeenCalledTimes(1);
  expect(updateTerminalTitle).toHaveBeenCalledTimes(1);
});

const doesNotSubscribeFromTheStaleStartup = () => Effect.runPromise(doesNotSubscribeFromTheStale);

describe("overlapping startup and replacement session rebinds", () => {
  it("does not subscribe from the stale startup rebind", doesNotSubscribeFromTheStaleStartup);
});
