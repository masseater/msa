import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type agentSessionTypes from "../src/core/agent-session.types.ts";
import type InteractiveMode from "../src/modes/interactive/interactive-mode.ts";
import SessionEventRouter from "../src/modes/interactive/mode/session-events.ts";
import ProgramStatusReporter from "../src/modes/interactive/program-status-reporter.ts";
import FakeTerminal from "./fake-terminal.ts";

const { awaited, runTest } = testing;

class RecordingTerminal extends FakeTerminal {
  titles: string[] = [];
  statuses: tuiTypes.ProgramStatus[] = [];

  override setTitle(title: string): void {
    this.titles.push(title);
  }

  override setProgramStatus(status?: tuiTypes.ProgramStatus): void {
    if (status !== undefined) this.statuses.push(status);
  }
}

const setup = () => {
  const terminal = new RecordingTerminal();
  const warnings: string[] = [];
  const fallback: { stalled: { at: number } | undefined } = { stalled: undefined };
  const mode = {
    display: { status: { showWarning: (message: string) => warnings.push(message) } },
    footer: { invalidate: () => {} },
    layout: {
      programStatus: new ProgramStatusReporter(
        () => terminal,
        () => undefined,
      ),
    },
    lifecycle: { startup: { isInitialized: true } },
    session: { run: { fallback } },
    sessionManager: { getCwd: () => "/work/repo", getSessionName: () => undefined },
    ui: { requestRender: () => {}, terminal },
    view: { streaming: { handleStreamEvent: () => false } },
  };
  const router = new SessionEventRouter(mode as unknown as InteractiveMode);
  const send = (event: agentSessionTypes.AgentSessionEvent) => awaited(router.handleEvent(event));
  return { fallback, send, terminal, warnings };
};

describe("provider alerts", () => {
  it("raises a terminal notification, blocks the program status, and marks the title while stopped", () =>
    runTest(
      Effect.gen(function* () {
        const { fallback, send, terminal } = setup();
        fallback.stalled = { at: 1 };
        yield* send({
          at: 1,
          errorMessage: '402: {"message":"This request requires more credits"}\nmore',
          model: "openrouter/m",
          type: "provider_stalled",
        });

        const alert = terminal.writes.join("");
        expect(alert).toContain(
          '\x1b]777;notify;msa;openrouter/m stopped: 402: {"message":"This request requires more credits"}\x07',
        );
        expect(alert.endsWith("\x07\x07")).toBe(true);
        expect(terminal.titles.at(-1)).toContain("(stopped)");
        expect(terminal.statuses.at(-1)).toMatchObject({ kind: "auth", state: "blocked" });

        fallback.stalled = undefined;
        yield* send({ model: "anthropic-api/m", since: 1, type: "provider_recovered" });

        expect(terminal.titles.at(-1)).not.toContain("(stopped)");
        expect(terminal.statuses.at(-1)?.state).not.toBe("blocked");
      }),
    ));

  it("tells the user which model took over", () =>
    runTest(
      Effect.gen(function* () {
        const { send, terminal, warnings } = setup();
        yield* send({
          errorMessage: "402: no credits",
          from: "openrouter/m",
          to: "anthropic-api/m",
          type: "model_fallback",
        });

        expect(warnings).toEqual([
          "openrouter/m failed (402: no credits). Switched to anthropic-api/m.",
        ]);
        expect(terminal.writes).toEqual([]);
      }),
    ));
});
