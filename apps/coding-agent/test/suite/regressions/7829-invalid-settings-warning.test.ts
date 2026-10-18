import { Container } from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { AgentSessionRuntimeDiagnostic } from "../../../src/core/agent-session-services.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { createHarness } from "../harness.ts";

function render(container: Container): string {
  return container.children.flatMap((child) => child.render(120)).join("\n");
}

const rendersStartupDiagnosticsInsideTheTranscript = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() => createHarness());
  vi.stubEnv("MSA_OFFLINE", "1");
  try {
    const chatContainer = new Container();
    const startupDiagnostics: AgentSessionRuntimeDiagnostic[] = [
      {
        type: "warning",
        message: "Invalid settings file /tmp/settings.json: malformed JSON",
      },
    ];
    const context = {
      init: vi.fn(() => runPromise(Effect.sync(() => {}))),
      options: { startupDiagnostics },
      chatContainer,
      outputPad: 1,
      ui: { requestRender: vi.fn() },
      version: "test",
      showWarning: (InteractiveMode.prototype as unknown as { showWarning(message: string): void })
        .showWarning,
      session: harness.session,
      checkForPackageUpdates: vi.fn().mockResolvedValue([]),
      checkTmuxKeyboardSetup: vi.fn().mockResolvedValue(undefined),
      getUserInput: vi.fn(() => new Promise<string>(() => {})),
    };
    const run = (
      InteractiveMode.prototype as unknown as { run(this: typeof context): Promise<void> }
    ).run;

    void run.call(context);

    yield* Effect.promise(() =>
      vi.waitFor(() => {
        expect(render(chatContainer)).toContain(
          "Warning: Invalid settings file /tmp/settings.json: malformed JSON",
        );
      }),
    );
  } finally {
    vi.unstubAllEnvs();
    harness.cleanup();
  }
});

describe("issue #7829 invalid settings warning", () => {
  beforeAll(() => initTheme("dark"));
  it("renders startup diagnostics inside the transcript", () =>
    Effect.runPromise(rendersStartupDiagnosticsInsideTheTranscript));
});
