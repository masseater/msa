import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { SessionImportFileNotFoundError } from "../src/core/agent-session-runtime.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

const { awaited, runTest } = testing;

type PathCommand = "/export" | "/import";

type InteractiveModePrototype = {
  getPathCommandArgument(this: unknown, text: string, command: PathCommand): string | undefined;
  handleImportCommand(this: ImportCommandContext, text: string): Promise<void>;
};

type ImportCommandContext = {
  clearStatusIndicator: () => void;
  runtimeHost: {
    importFromJsonl: (inputPath: string, cwdOverride?: string) => Promise<{ cancelled: boolean }>;
  };
  showError: (message: string) => void;
  showStatus: (message: string) => void;
  extensionDialogs: { confirm: (title: string, message: string) => Promise<boolean> };
  handleRuntimeSessionChange: () => Promise<void>;
  renderCurrentSessionState: () => void;
  handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<never>;
  promptForMissingSessionCwd: (error: unknown) => Promise<string | undefined>;
  getPathCommandArgument: (text: string, command: PathCommand) => string | undefined;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("InteractiveMode /import parsing", () => {
  it("strips quotes from /import path arguments", () => {
    expect(
      interactiveModePrototype.getPathCommandArgument('/import "path/to/session.jsonl"', "/import"),
    ).toBe("path/to/session.jsonl");
    expect(
      interactiveModePrototype.getPathCommandArgument(
        '/import "path with spaces/session.jsonl"',
        "/import",
      ),
    ).toBe("path with spaces/session.jsonl");
  });

  it("preserves apostrophes in unquoted /import path arguments", () => {
    expect(
      interactiveModePrototype.getPathCommandArgument("/import john's/session.jsonl", "/import"),
    ).toBe("john's/session.jsonl");
  });

  it("enforces command token boundaries", () => {
    expect(
      interactiveModePrototype.getPathCommandArgument("/important /tmp/session.jsonl", "/import"),
    ).toBe(undefined);
    expect(interactiveModePrototype.getPathCommandArgument("/exporter out.html", "/export")).toBe(
      undefined,
    );
    expect(
      interactiveModePrototype.getPathCommandArgument("/import /tmp/session.jsonl", "/import"),
    ).toBe("/tmp/session.jsonl");
  });
});

describe("InteractiveMode /import parsing", () => {
  it("passes unquoted path to runtimeHost.importFromJsonl", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const importFromJsonl = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));
        const showExtensionConfirm = vi.fn(() => effectRunPromise(awaited(true)));
        const showStatus = vi.fn();
        const showError = vi.fn();

        const context: ImportCommandContext = {
          clearStatusIndicator: vi.fn(),
          extensionDialogs: { confirm: showExtensionConfirm },
          getPathCommandArgument: interactiveModePrototype.getPathCommandArgument,
          handleFatalRuntimeError: vi.fn(() =>
            effectRunPromise(
              Effect.sync(() => {
                throw new Error("unexpected fatal error");
              }),
            ),
          ),
          handleRuntimeSessionChange: vi.fn(() => effectRunPromise(Effect.sync(() => {}))),
          promptForMissingSessionCwd: vi.fn(() => effectRunPromise(awaited(undefined))),
          renderCurrentSessionState: vi.fn(),
          runtimeHost: { importFromJsonl },
          showError,
          showStatus,
        };

        yield* awaited(
          interactiveModePrototype.handleImportCommand.call(
            context,
            '/import "path/to/session.jsonl"',
          ),
        );

        expect(showExtensionConfirm).toHaveBeenCalledWith(
          "Import session",
          "Replace current session with path/to/session.jsonl?",
        );
        expect(importFromJsonl).toHaveBeenCalledWith("path/to/session.jsonl");
        expect(showError).not.toHaveBeenCalled();
        expect(showStatus).toHaveBeenCalledWith("Session imported from: path/to/session.jsonl");
      }),
    ));
});

describe("InteractiveMode /import parsing", () => {
  it("passes unquoted apostrophe path to runtimeHost.importFromJsonl unchanged", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const importFromJsonl = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));
        const showExtensionConfirm = vi.fn(() => effectRunPromise(awaited(true)));
        const showStatus = vi.fn();
        const showError = vi.fn();

        const context: ImportCommandContext = {
          clearStatusIndicator: vi.fn(),
          extensionDialogs: { confirm: showExtensionConfirm },
          getPathCommandArgument: interactiveModePrototype.getPathCommandArgument,
          handleFatalRuntimeError: vi.fn(() =>
            effectRunPromise(
              Effect.sync(() => {
                throw new Error("unexpected fatal error");
              }),
            ),
          ),
          handleRuntimeSessionChange: vi.fn(() => effectRunPromise(Effect.sync(() => {}))),
          promptForMissingSessionCwd: vi.fn(() => effectRunPromise(awaited(undefined))),
          renderCurrentSessionState: vi.fn(),
          runtimeHost: { importFromJsonl },
          showError,
          showStatus,
        };

        yield* awaited(
          interactiveModePrototype.handleImportCommand.call(
            context,
            "/import john's/session.jsonl",
          ),
        );

        expect(importFromJsonl).toHaveBeenCalledWith("john's/session.jsonl");
        expect(showError).not.toHaveBeenCalled();
        expect(showStatus).toHaveBeenCalledWith("Session imported from: john's/session.jsonl");
      }),
    ));
});

const missingFileContext = () => {
  const showStatus = vi.fn();
  const showError = vi.fn();
  const handleFatalRuntimeError = vi.fn(() => Promise.reject(new Error("unexpected fatal error")));
  const context: ImportCommandContext = {
    clearStatusIndicator: vi.fn(),
    extensionDialogs: { confirm: vi.fn(() => Promise.resolve(true)) },
    getPathCommandArgument: interactiveModePrototype.getPathCommandArgument,
    handleFatalRuntimeError,
    handleRuntimeSessionChange: vi.fn(() => Promise.resolve()),
    promptForMissingSessionCwd: vi.fn(() => Promise.resolve(undefined)),
    renderCurrentSessionState: vi.fn(),
    runtimeHost: {
      importFromJsonl: vi.fn(() =>
        Promise.reject(new SessionImportFileNotFoundError("/tmp/missing-session.jsonl")),
      ),
    },
    showError,
    showStatus,
  };
  return { context, handleFatalRuntimeError, showError, showStatus };
};

const showsANonFatalErrorForAMissingPath = Effect.gen(function* () {
  const { context, handleFatalRuntimeError, showError, showStatus } = missingFileContext();
  yield* awaited(
    interactiveModePrototype.handleImportCommand.call(
      context,
      "/import /tmp/missing-session.jsonl",
    ),
  );
  expect(showError).toHaveBeenCalledWith(
    "Failed to import session: File not found: /tmp/missing-session.jsonl",
  );
  expect(showStatus).not.toHaveBeenCalled();
  expect(handleFatalRuntimeError).not.toHaveBeenCalled();
});

describe("InteractiveMode /import parsing", () => {
  it("shows a non-fatal error when /import path does not exist", () =>
    runTest(showsANonFatalErrorForAMissingPath));
});
