import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { AgentSessionRuntimeDiagnostic } from "../../../src/core/agent-session-services.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import harnessModule from "../harness.ts";

const { Container } = tui;

const { createHarness } = harnessModule;

const { neverPromise } = testing;

function render(container: tuiTypes.Container): string {
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
        message: "Invalid settings file /tmp/settings.json: malformed JSON",
        type: "warning",
      },
    ];
    const context = {
      chatContainer,
      checkForPackageUpdates: vi.fn().mockResolvedValue([]),
      checkTmuxKeyboardSetup: vi.fn().mockResolvedValue(undefined),
      getUserInput: vi.fn(() => neverPromise<string>()),
      init: vi.fn(() => runPromise(Effect.sync(() => {}))),
      options: { startupDiagnostics },
      outputPad: 1,
      session: harness.session,
      showWarning: (InteractiveMode.prototype as unknown as { showWarning(message: string): void })
        .showWarning,
      ui: { requestRender: vi.fn() },
      version: "test",
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

const rendersStartupDiagnosticsInsideTheTranscript2 = () =>
  Effect.runPromise(rendersStartupDiagnosticsInsideTheTranscript);

describe("issue #7829 invalid settings warning", () => {
  beforeAll(() => initTheme("dark"));
  it(
    "renders startup diagnostics inside the transcript",
    rendersStartupDiagnosticsInsideTheTranscript2,
  );
});
