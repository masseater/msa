import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import chalk from "chalk";
import { Cause, Effect, Exit, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { APP_NAME } from "../../../src/config.ts";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import SignalShutdownExtensionCleanupSupport from "./5080-signal-shutdown-extension-cleanup-support.ts";
const { ProcessExitError } = SignalShutdownExtensionCleanupSupport;

const { joinPath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);

const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

type ShutdownThis = {
  isShuttingDown: boolean;
  unregisterSignalHandlers: () => void;
  runtimeHost: { dispose: () => Promise<void> };
  ui: { terminal: { drainInput: (ms: number) => Promise<void> } };
  themeController: { disableAutoSync: () => void };
  stop: () => void;
  sessionManager: SessionManager;
};

type InteractiveModePrototypeWithShutdown = {
  shutdown(this: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown;

const tempDirs: string[] = [];

const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function createSessionManager(options: { sessionFile?: string } = {}): SessionManager {
  return {
    getSessionDir: () => "/tmp/msa-sessions",
    getSessionFile: () => options.sessionFile,
    getSessionId: () => "test-session",
    isPersisted: () => options.sessionFile !== undefined,
    usesDefaultSessionDir: () => true,
  } as unknown as SessionManager;
}

function createTempFile() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const dir = yield* fs.makeTempDirectory({ prefix: "msa-shutdown-resume-hint-" });
      tempDirs.push(dir);
      const file = joinPath(dir, "session.jsonl");
      yield* fs.writeFileString(file, "\n");
      return file;
    }),
  );
}

function setStdoutIsTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

function restoreStdoutIsTTY(): void {
  if (originalStdoutIsTTY === undefined) {
    Reflect.deleteProperty(process.stdout, "isTTY");
  } else {
    Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
  }
}

function createContext(order: string[], sessionManager = createSessionManager()): ShutdownThis {
  return {
    isShuttingDown: false,
    runtimeHost: {
      dispose: vi.fn(() =>
        Effect.runPromise(
          Effect.sync(() => {
            order.push("dispose");
          }),
        ),
      ),
    },
    sessionManager,
    stop: vi.fn(() => {
      order.push("stop");
    }),
    themeController: { disableAutoSync: vi.fn() },
    ui: {
      terminal: {
        drainInput: vi.fn(() =>
          Effect.runPromise(
            Effect.sync(() => {
              order.push("drainInput");
            }),
          ),
        ),
      },
    },
    unregisterSignalHandlers: vi.fn(),
  };
}

function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      {
        const tryExit4 = yield* Effect.exit(
          Effect.promise(() =>
            (interactiveModePrototype as InteractiveModePrototypeWithShutdown).shutdown.call(
              context,
              options,
            ),
          ),
        );
        if (Exit.isFailure(tryExit4)) {
          const error = Cause.squash(tryExit4.cause);
          if (!(error instanceof ProcessExitError)) throw error;
        }
      }
    }),
  );
}

const signalTriggeredShutdownEmitsSessionShutdown = Effect.gen(function* () {
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError({});
  }) as typeof process.exit);
  const order: string[] = [];
  const context = createContext(order);

  yield* Effect.promise(() => callShutdown(context, { fromSignal: true }));

  expect(order).toEqual(["dispose", "drainInput", "stop"]);
  expect(context.isShuttingDown).toBe(true);
});

const interactiveQuitStopsTheTuiBefore = Effect.gen(function* () {
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError({});
  }) as typeof process.exit);
  const order: string[] = [];
  const context = createContext(order);

  yield* Effect.promise(() => callShutdown(context));

  expect(order).toEqual(["drainInput", "stop", "dispose"]);
});

const interactiveQuitPrintsAResumeHint = Effect.gen(function* () {
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError({});
  }) as typeof process.exit);
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((() => true) as typeof process.stdout.write);
  setStdoutIsTTY(true);
  const order: string[] = [];
  const context = createContext(
    order,
    createSessionManager({ sessionFile: yield* Effect.promise(() => createTempFile()) }),
  );

  yield* Effect.promise(() => callShutdown(context));

  expect(order).toEqual(["drainInput", "stop", "dispose"]);
  expect(stdoutWrite).toHaveBeenCalledWith(
    `${chalk.dim("To resume this session:")} ${APP_NAME} --session test-session\n`,
  );
});

const signalTriggeredShutdownDoesNotPrint = Effect.gen(function* () {
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError({});
  }) as typeof process.exit);
  const stdoutWrite = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((() => true) as typeof process.stdout.write);
  setStdoutIsTTY(true);
  const order: string[] = [];
  const context = createContext(
    order,
    createSessionManager({ sessionFile: yield* Effect.promise(() => createTempFile()) }),
  );

  yield* Effect.promise(() => callShutdown(context, { fromSignal: true }));

  for (const call of stdoutWrite.mock.calls) {
    expect(call[0]).not.toContain("To resume this session:");
  }
});

const reEntrantShutdownIsANo = Effect.gen(function* () {
  vi.spyOn(process, "exit").mockImplementation((() => {
    throw new ProcessExitError({});
  }) as typeof process.exit);
  const order: string[] = [];
  const context = createContext(order);
  context.isShuttingDown = true;

  yield* Effect.promise(() => callShutdown(context, { fromSignal: true }));

  expect(order).toEqual([]);
  expect(context.runtimeHost.dispose).not.toHaveBeenCalled();
});

const signalTriggeredShutdownEmitsSessionShutdownBefore = () =>
  Effect.runPromise(signalTriggeredShutdownEmitsSessionShutdown);

const interactiveQuitStopsTheTuiBeforeEmitting = () =>
  Effect.runPromise(interactiveQuitStopsTheTuiBefore);

const interactiveQuitPrintsAResumeHintFor = () =>
  Effect.runPromise(interactiveQuitPrintsAResumeHint);

const signalTriggeredShutdownDoesNotPrintA = () =>
  Effect.runPromise(signalTriggeredShutdownDoesNotPrint);

const reEntrantShutdownIsANoOp = () => Effect.runPromise(reEntrantShutdownIsANo);

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      vi.restoreAllMocks();
      restoreStdoutIsTTY();
      for (const dir of tempDirs.splice(0)) {
        yield* fs.remove(dir, { force: true, recursive: true });
      }
    }),
  );

describe("InteractiveMode.shutdown ordering (#5080)", () => {
  afterEach(afterEachHook);
  test(
    "signal-triggered shutdown emits session_shutdown before terminal writes",
    signalTriggeredShutdownEmitsSessionShutdownBefore,
  );
  test(
    "interactive quit stops the TUI before emitting session_shutdown",
    interactiveQuitStopsTheTuiBeforeEmitting,
  );
  test(
    "interactive quit prints a resume hint for persisted sessions",
    interactiveQuitPrintsAResumeHintFor,
  );
  test(
    "signal-triggered shutdown does not print a resume hint",
    signalTriggeredShutdownDoesNotPrintA,
  );
  test("re-entrant shutdown is a no-op", reEntrantShutdownIsANoOp);
});
