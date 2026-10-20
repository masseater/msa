import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import SignalShutdownExtensionCleanupSupport from "./5080-signal-shutdown-extension-cleanup-support.ts";
import type SignalShutdownExtensionCleanupSupportTypes from "./5080-signal-shutdown-extension-cleanup-support.types.ts";

const { ProcessExitError } = SignalShutdownExtensionCleanupSupport;

type InteractiveModePrivates = {
  registerSignalHandlers(this: SignalShutdownExtensionCleanupSupportTypes.HandlerContext): void;
  unregisterSignalHandlers(this: SignalShutdownExtensionCleanupSupportTypes.HandlerContext): void;
  emergencyTerminalExit(this: SignalShutdownExtensionCleanupSupportTypes.HandlerContext): never;
  uncaughtCrash(
    this: SignalShutdownExtensionCleanupSupportTypes.HandlerContext,
    error: Error,
  ): never;
};

const proto = InteractiveMode.prototype as unknown as InteractiveModePrivates;

function createHandlerContext(): SignalShutdownExtensionCleanupSupportTypes.HandlerContext {
  const context: SignalShutdownExtensionCleanupSupportTypes.HandlerContext = {
    crashReportInstructions: () => "",
    emergencyTerminalExit: () => proto.emergencyTerminalExit.call(context),
    getCrashExtensionHint: () => undefined,
    isShuttingDown: false,
    recordCrash: vi.fn(() => true),
    shutdown: vi.fn(() => Effect.runPromise(Effect.sync(() => {}))),
    signalCleanupHandlers: [],
    ui: { stop: vi.fn() },
    uncaughtCrash: (error: Error) => proto.uncaughtCrash.call(context, error),
    unregisterSignalHandlers: () => proto.unregisterSignalHandlers.call(context),
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

let context: SignalShutdownExtensionCleanupSupportTypes.HandlerContext | undefined;

function setup(): SignalShutdownExtensionCleanupSupportTypes.HandlerContext {
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

const otherStdinErrorsStillCrash = () => {
  setup();
  const error = errnoError("read ECONNREFUSED", "ECONNREFUSED");

  expect(() => process.stdin.emit("error", error)).toThrow(error);
};

const afterEachHook = () => {
  context?.unregisterSignalHandlers();
  context = undefined;
  vi.restoreAllMocks();
};

describe("dead terminal errors on stdin", () => {
  afterEach(afterEachHook);
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
  test("other stdin errors still crash", otherStdinErrorsStillCrash);
  test(
    "uncaught dead terminal errors are not recorded as crashes",
    uncaughtDeadTerminalErrorsAreNot,
  );
  test("other uncaught errors are still recorded as crashes", otherUncaughtErrorsAreStillRecorded);
  test("handlers are removed on unregister", handlersAreRemovedOnUnregister);
});
