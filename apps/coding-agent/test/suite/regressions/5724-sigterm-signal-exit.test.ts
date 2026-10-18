import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";

type ShutdownThis = {
  isShuttingDown: boolean;
  unregisterSignalHandlers: () => void;
  runtimeHost: { dispose: () => Promise<void> };
  ui: { terminal: { drainInput: (ms: number) => Promise<void> } };
  themeController: { disableAutoSync: () => void };
  stop: () => void;
};

type InteractiveModePrototypeWithShutdown = {
  shutdown(this: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown;

class ProcessExitError extends Error {}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: () => resolve?.(),
  };
}

function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      {
        const tryExit5 = yield* Effect.exit(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              (interactiveModePrototype as InteractiveModePrototypeWithShutdown).shutdown.call(
                context,
                options,
              ),
            );
          }),
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
    unregisterSignalHandlers: vi.fn(() => {
      order.push("unregister");
    }),
    runtimeHost: {
      dispose: vi.fn(() => {
        order.push("dispose");
        return dispose.promise;
      }),
    },
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
    themeController: { disableAutoSync: vi.fn() },
    stop: vi.fn(() => {
      order.push("stop");
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

describe("InteractiveMode SIGTERM shutdown with signal-exit (#5724)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  test("keeps signal handlers registered while signal-triggered cleanup is pending", () =>
    Effect.runPromise(keepsSignalHandlersRegisteredWhileSignal));
});
