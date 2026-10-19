import { awaited, runTest } from "@msa/testing";
import { Container, Editor, setKeybindings, TuiMainScreen } from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { LoginDialogComponent } from "../src/modes/interactive/components/login-dialog.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { LoginFlow } from "../src/modes/interactive/login-flow.ts";
import type { ProgramStatusReporter } from "../src/modes/interactive/program-status-reporter.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("dark"));

describe("LoginFlow", () => {
  it("treats Escape in the credential prompt as a cancellation, not a failure", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        setKeybindings(new KeybindingsManager());
        const ui = new TuiMainScreen(new VirtualTerminal());
        const container = new Container();
        const editor = new Editor(ui, getEditorTheme());
        const editorSlot = new EditorSlot(container, ui, () => editor);
        editorSlot.show(editor);
        const provider = {
          id: "acme",
          name: "Acme",
          auth: { apiKey: { name: "Acme API key", login: () => effectRunPromise(awaited({})) } },
        };
        const session = {
          model: undefined,
          settingsManager: { getOrCreateDeviceId: () => "device" },
          getExternalServices: () => [],
          modelRuntime: {
            getProviders: () => [provider],
            getProviderAuthStatus: () => ({ configured: false }),
            isUsingOAuth: () => false,

            login: (
              _id: string,
              _method: string,
              callbacks: { signal: AbortSignal; prompt: (prompt: unknown) => Promise<string> },
            ) =>
              effectRunPromise(
                Effect.gen(function* () {
                  void callbacks
                    .prompt({ type: "text" as const, message: "Enter Acme API key" })
                    .catch(() => {});
                  yield* awaited(
                    new Promise((_resolve, reject) => {
                      callbacks.signal.addEventListener(
                        "abort",
                        () => reject(callbacks.signal.reason),
                        {
                          once: true,
                        },
                      );
                    }),
                  );
                }),
              ),
          },
        } as unknown as AgentSession;
        const showError = vi.fn();
        const flow = new LoginFlow({
          ui,
          session,
          programStatus: { setBlocked: () => {} } as unknown as ProgramStatusReporter,
          editorSlot,
          showStatus: () => {},
          showWarning: () => {},
          showError,
          refreshAuthState: () => {},
        });

        const login = flow.login("acme");
        yield* awaited(
          vi.waitFor(() => expect(container.children[0]).toBeInstanceOf(LoginDialogComponent)),
        );
        container.children[0]!.handleInput!("\x1b");
        yield* awaited(login);

        expect(showError).not.toHaveBeenCalled();
        expect(container.children).toEqual([editor]);
      }),
    ));
});
