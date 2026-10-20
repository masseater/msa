import testing from "@msa/testing";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { AgentSession } from "../src/core/agent-session.ts";
import { LoginDialogComponent } from "../src/modes/interactive/components/login-dialog.ts";
import { LoginFlow } from "../src/modes/interactive/login-flow.ts";
import type { ProgramStatusReporter } from "../src/modes/interactive/program-status-reporter.ts";
import editorSlotUi from "./editor-slot-ui.ts";

const { awaited, runTest } = testing;

const { createEditorSlotUi, prepareTheme } = editorSlotUi;

beforeAll(prepareTheme);

interface LoginCallbacks {
  signal: AbortSignal;
  prompt: (prompt: unknown) => Promise<string>;
}

const untilAborted = (signal: AbortSignal) =>
  Effect.callback<never>((resume) => {
    signal.addEventListener("abort", () => resume(Effect.die(signal.reason)), { once: true });
  });

const promptingSession = (): AgentSession => {
  const provider = {
    auth: { apiKey: { login: () => Promise.resolve({}), name: "Acme API key" } },
    id: "acme",
    name: "Acme",
  };
  return {
    getExternalServices: () => [],
    model: undefined,
    modelRuntime: {
      getProviderAuthStatus: () => ({ configured: false }),
      getProviders: () => [provider],
      isUsingOAuth: () => false,
      login: (_id: string, _method: string, callbacks: LoginCallbacks) => {
        void callbacks.prompt({ message: "Enter Acme API key", type: "text" }).catch(() => {});
        return runTest(untilAborted(callbacks.signal));
      },
    },
    settingsManager: { getOrCreateDeviceId: () => "device" },
  } as unknown as AgentSession;
};

const treatsEscapeInTheCredentialPromptAs = Effect.gen(function* () {
  const { container, editor, editorSlot, ui } = createEditorSlotUi();
  editorSlot.show(editor);
  const showError = vi.fn();
  const flow = new LoginFlow({
    editorSlot,
    programStatus: { setBlocked: () => {} } as unknown as ProgramStatusReporter,
    refreshAuthState: () => {},
    session: promptingSession(),
    showError,
    showStatus: () => {},
    showWarning: () => {},
    ui,
  });
  const login = flow.login("acme");
  yield* awaited(
    vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(LoginDialogComponent)),
  );
  container.children[0]?.handleInput?.("\x1b");
  yield* awaited(login);
  expect(showError).not.toHaveBeenCalled();
  expect(container.children).toEqual([editor]);
});

describe("LoginFlow", () => {
  it("treats Escape in the credential prompt as a cancellation, not a failure", () =>
    runTest(treatsEscapeInTheCredentialPromptAs));
});
