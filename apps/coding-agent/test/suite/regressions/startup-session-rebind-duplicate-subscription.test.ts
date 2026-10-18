import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";

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

type InteractiveModePrototype = {
  rebindCurrentSession(
    this: RebindContext,
    options?: { renderBeforeBind?: boolean },
  ): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

const doesNotSubscribeFromTheStale = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const startupSession = {};
  const replacementSession = {};
  let resolveStartupBind!: () => void;
  let resolveReplacementBind!: () => void;

  const startupBind = new Promise<void>((resolve) => {
    resolveStartupBind = resolve;
  });
  const replacementBind = new Promise<void>((resolve) => {
    resolveReplacementBind = resolve;
  });

  const subscribeToAgent = vi.fn();
  const updateTerminalTitle = vi.fn();
  let bindCount = 0;

  const context: RebindContext = {
    session: startupSession,
    applyRuntimeSettings: () => {},
    programStatus: { reset: () => {} },
    renderCurrentSessionState: () => {},
    bindCurrentSessionExtensions: () => {
      bindCount += 1;
      return bindCount === 1 ? startupBind : replacementBind;
    },
    subscribeToAgent,
    updateAvailableProviderCount: () => runPromise(Effect.sync(() => {})),
    updateEditorBorderColor: () => {},
    updateTerminalTitle,
  };

  const startupRebind = interactiveModePrototype.rebindCurrentSession.call(context);
  expect(bindCount).toBe(1);

  context.session = replacementSession;
  const replacementRebind = interactiveModePrototype.rebindCurrentSession.call(context, {
    renderBeforeBind: true,
  });

  expect(bindCount).toBe(2);
  expect(subscribeToAgent).toHaveBeenCalledTimes(1);

  resolveStartupBind();
  yield* Effect.promise(() => startupRebind);

  expect(subscribeToAgent).toHaveBeenCalledTimes(1);
  expect(updateTerminalTitle).not.toHaveBeenCalled();

  resolveReplacementBind();
  yield* Effect.promise(() => replacementRebind);

  expect(subscribeToAgent).toHaveBeenCalledTimes(1);
  expect(updateTerminalTitle).toHaveBeenCalledTimes(1);
});

describe("overlapping startup and replacement session rebinds", () => {
  it("does not subscribe from the stale startup rebind", () =>
    Effect.runPromise(doesNotSubscribeFromTheStale));
});
