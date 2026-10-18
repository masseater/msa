import * as NodeServices from "@effect/platform-node/NodeServices";
import { joinPath } from "@msa/testing";
import chalk from "chalk";
import { Cause, Data, Effect, Exit, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { APP_NAME } from "../../../src/config.ts";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";

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

class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
  readonly code?: number;
}> {}

function createSessionManager(options: { sessionFile?: string } = {}): SessionManager {
  return {
    isPersisted: () => options.sessionFile !== undefined,
    getSessionFile: () => options.sessionFile,
    getSessionId: () => "test-session",
    getSessionDir: () => "/tmp/msa-sessions",
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
    unregisterSignalHandlers: vi.fn(),
    runtimeHost: {
      dispose: vi.fn(() =>
        Effect.runPromise(
          Effect.sync(() => {
            order.push("dispose");
          }),
        ),
      ),
    },
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
    themeController: { disableAutoSync: vi.fn() },
    stop: vi.fn(() => {
      order.push("stop");
    }),
    sessionManager,
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

describe("InteractiveMode.shutdown ordering (#5080)", () => {
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        vi.restoreAllMocks();
        restoreStdoutIsTTY();
        for (const dir of tempDirs.splice(0)) {
          yield* fs.remove(dir, { recursive: true, force: true });
        }
      }),
    ),
  );
  test("signal-triggered shutdown emits session_shutdown before terminal writes", () =>
    Effect.runPromise(signalTriggeredShutdownEmitsSessionShutdown));
  test("interactive quit stops the TUI before emitting session_shutdown", () =>
    Effect.runPromise(interactiveQuitStopsTheTuiBefore));
  test("interactive quit prints a resume hint for persisted sessions", () =>
    Effect.runPromise(interactiveQuitPrintsAResumeHint));
  test("signal-triggered shutdown does not print a resume hint", () =>
    Effect.runPromise(signalTriggeredShutdownDoesNotPrint));
  test("re-entrant shutdown is a no-op", () => Effect.runPromise(reEntrantShutdownIsANo));
});

type HandlerContext = {
  isShuttingDown: boolean;
  signalCleanupHandlers: Array<() => void>;
  shutdown: () => Promise<void>;
  unregisterSignalHandlers: () => void;
  emergencyTerminalExit: () => never;
  uncaughtCrash: (error: Error) => never;
  recordCrash: () => boolean;
  getCrashExtensionHint: () => string | undefined;
  crashReportInstructions: () => string;
  ui: { stop: () => void };
};

type InteractiveModePrivates = {
  registerSignalHandlers(this: HandlerContext): void;
  unregisterSignalHandlers(this: HandlerContext): void;
  emergencyTerminalExit(this: HandlerContext): never;
  uncaughtCrash(this: HandlerContext, error: Error): never;
};

const proto = InteractiveMode.prototype as unknown as InteractiveModePrivates;

function createHandlerContext(): HandlerContext {
  const context: HandlerContext = {
    isShuttingDown: false,
    signalCleanupHandlers: [],
    shutdown: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    unregisterSignalHandlers: () => proto.unregisterSignalHandlers.call(context),
    emergencyTerminalExit: () => proto.emergencyTerminalExit.call(context),
    uncaughtCrash: (error: Error) => proto.uncaughtCrash.call(context, error),
    recordCrash: vi.fn(() => true),
    getCrashExtensionHint: () => undefined,
    crashReportInstructions: () => "",
    ui: { stop: vi.fn() },
  };
  return context;
}

function errnoError(message: string, code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function captureExit(fn: () => void): number | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProcessExitError) return error.code;
    throw error;
  }
  throw new Error("expected process.exit");
}

let context: HandlerContext | undefined;

function setup(): HandlerContext {
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code === undefined ? {} : { code });
  }) as typeof process.exit);
  vi.spyOn(console, "error").mockImplementation(() => {});
  context = createHandlerContext();
  proto.registerSignalHandlers.call(context);
  return context;
}

const uncaughtDeadTerminalErrorsAreNot = () => {
  const ctx = setup();

  const exitCode = captureExit(() => ctx.uncaughtCrash(errnoError("read EIO", "EIO")));

  expect(exitCode).toBe(129);
  expect(ctx.recordCrash).not.toHaveBeenCalled();
};

const otherUncaughtErrorsAreStillRecorded = () => {
  const ctx = setup();

  const exitCode = captureExit(() => ctx.uncaughtCrash(new Error("boom")));

  expect(exitCode).toBe(1);
  expect(ctx.recordCrash).toHaveBeenCalledOnce();
};

const handlersAreRemovedOnUnregister = () => {
  const ctx = setup();
  const before = process.stdin.listenerCount("error");

  ctx.unregisterSignalHandlers();

  expect(process.stdin.listenerCount("error")).toBe(before - 1);
};

describe("dead terminal errors on stdin", () => {
  afterEach(() => {
    context?.unregisterSignalHandlers();
    context = undefined;
    vi.restoreAllMocks();
  });
  test.each([
    ["read EIO", "EIO"],
    ["setRawMode EIO", "EIO"],
    ["setRawMode ENOTTY", "ENOTTY"],
  ])("stdin %s exits quietly without recording a crash", (message, code) => {
    const ctx = setup();

    const exitCode = captureExit(() => process.stdin.emit("error", errnoError(message, code)));

    expect(exitCode).toBe(129);
    expect(ctx.recordCrash).not.toHaveBeenCalled();
    expect(ctx.ui.stop).not.toHaveBeenCalled();
  });
  test("other stdin errors still crash", () => {
    setup();
    const error = errnoError("read ECONNREFUSED", "ECONNREFUSED");

    expect(() => process.stdin.emit("error", error)).toThrow(error);
  });
  test(
    "uncaught dead terminal errors are not recorded as crashes",
    uncaughtDeadTerminalErrorsAreNot,
  );
  test("other uncaught errors are still recorded as crashes", otherUncaughtErrorsAreStillRecorded);
  test("handlers are removed on unregister", handlersAreRemovedOnUnregister);
});
