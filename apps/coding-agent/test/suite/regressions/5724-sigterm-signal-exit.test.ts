import testing from "@msa/testing";
import { Cause, Data, Effect, Exit } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import interactiveModeFake from "../../interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const { gate } = testing;

type ShutdownThis = {
  isShuttingDown: boolean;
  unregisterSignalHandlers: () => void;
  runtimeHost: { dispose: () => Promise<void> };
  ui: { terminal: { drainInput: (ms: number) => Promise<void> } };
  themeController: { disableAutoSync: () => void };
  stop: () => void;
};

class ProcessExitError extends Data.TaggedError("ProcessExitError")<{}> {}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  const promise = gate();
  return {
    promise,
    resolve: () => promise.release(),
  };
}

function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      {
        const tryExit5 = yield* Effect.exit(
          Effect.promise(() => bindModeFake(context).lifecycle.shutdown.shutdown(options)),
        );
        if (Exit.isFailure(tryExit5)) {
          const error = Cause.squash(tryExit5.cause);
          if (!(error instanceof ProcessExitError)) throw error;
        }
      }
    }),
  );
}

const keepsSignalHandlersRegisteredWhileSignal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError();
  }) as typeof process.exit);

  const order: string[] = [];
  const dispose = deferred();
  const context: ShutdownThis = {
    isShuttingDown: false,
    runtimeHost: {
      dispose: vi.fn(() => {
        order.push("dispose");
        return dispose.promise;
      }),
    },
    stop: vi.fn(() => {
      order.push("stop");
    }),
    themeController: { disableAutoSync: vi.fn() },
    ui: {
      terminal: {
        drainInput: vi.fn(() =>
          runPromise(
            Effect.sync(() => {
              order.push("drainInput");
            }),
          ),
        ),
      },
    },
    unregisterSignalHandlers: vi.fn(() => {
      order.push("unregister");
    }),
  };

  const shutdownPromise = callShutdown(context, { fromSignal: true });
  yield* Effect.promise(() => Promise.resolve());

  expect(order).toEqual(["dispose"]);
  expect(context.unregisterSignalHandlers).not.toHaveBeenCalled();

  dispose.resolve();
  yield* Effect.promise(() => shutdownPromise);

  expect(order).toEqual(["dispose", "drainInput", "stop"]);
});

const keepsSignalHandlersRegisteredWhileSignalTriggered = () =>
  Effect.runPromise(keepsSignalHandlersRegisteredWhileSignal);

describe("InteractiveMode SIGTERM shutdown with signal-exit (#5724)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  test(
    "keeps signal handlers registered while signal-triggered cleanup is pending",
    keepsSignalHandlersRegisteredWhileSignalTriggered,
  );
});
