import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";

const { awaited, runTest } = testing;

type CloneCommandContext = {
  sessionManager: { getLeafId: () => string | null };
  runtimeHost: {
    fork: (
      entryId: string,
      options?: { position?: "before" | "at" },
    ) => Promise<{ cancelled: boolean }>;
  };
  renderCurrentSessionState: () => void;
  editor: { setText: (text: string) => void };
  showStatus: (message: string) => void;
  showError: (message: string) => void;
  ui: { requestRender: () => void };
};

type InteractiveModePrototype = {
  handleCloneCommand(this: CloneCommandContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("InteractiveMode /clone", () => {
  it("clones the current leaf into a new session", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const fork = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));
        const renderCurrentSessionState = vi.fn();
        const setText = vi.fn();
        const showStatus = vi.fn();
        const showError = vi.fn();
        const requestRender = vi.fn();

        const context: CloneCommandContext = {
          editor: { setText },
          renderCurrentSessionState,
          runtimeHost: { fork },
          sessionManager: { getLeafId: () => "leaf-123" },
          showError,
          showStatus,
          ui: { requestRender },
        };

        yield* awaited(interactiveModePrototype.handleCloneCommand.call(context));

        expect(fork).toHaveBeenCalledWith("leaf-123", { position: "at" });
        expect(renderCurrentSessionState).not.toHaveBeenCalled();
        expect(setText).toHaveBeenCalledWith("");
        expect(showStatus).toHaveBeenCalledWith("Cloned to new session");
        expect(showError).not.toHaveBeenCalled();
        expect(requestRender).not.toHaveBeenCalled();
      }),
    ));
});

describe("InteractiveMode /clone", () => {
  it("shows a status message when there is nothing to clone", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const fork = vi.fn(() => effectRunPromise(awaited({ cancelled: false })));
        const showStatus = vi.fn();
        const showError = vi.fn();

        const context: CloneCommandContext = {
          editor: { setText: vi.fn() },
          renderCurrentSessionState: vi.fn(),
          runtimeHost: { fork },
          sessionManager: { getLeafId: () => null },
          showError,
          showStatus,
          ui: { requestRender: vi.fn() },
        };

        yield* awaited(interactiveModePrototype.handleCloneCommand.call(context));

        expect(fork).not.toHaveBeenCalled();
        expect(showStatus).toHaveBeenCalledWith("Nothing to clone yet");
        expect(showError).not.toHaveBeenCalled();
      }),
    ));
});
