import { fileURLToPath } from "node:url";

import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Console, Effect } from "effect";

import agentProcess from "./rpc-ui/agent-process.ts";
import UiController from "./rpc-ui/controller.ts";
import type controllerTypes from "./rpc-ui/controller.types.ts";
import slashCommands from "./rpc-ui/slash-commands.ts";
const { startAgent } = agentProcess;
const { showWelcome } = slashCommands;

const { ProcessTerminal, TuiMainScreen } = tuiModule;

const here = fileURLToPath(new URL(".", import.meta.url));
const extensionPath = `${here}extensions/rpc-demo.ts`;
const cliPath = `${here}../dist/cli.js`;

const fail = (message: string): never => {
  Effect.runSync(Console.error(message));
  process.exit(1);
};

const parseLine = (line: string): Record<string, unknown> | undefined => {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const handleExit =
  (terminal: { stop: () => void }, agent: () => { stderrText: () => string }) =>
  (code: number): void => {
    terminal.stop();
    const stderr = agent().stderrText();
    if (stderr.length > 0) Effect.runSync(Console.error(stderr));
    Effect.runSync(Console.log(`Agent exited with code ${code}`));
    process.exit(code);
  };

const main = () =>
  Effect.gen(function* () {
    const terminal = new ProcessTerminal();
    const tui: tuiTypes.TUI = new TuiMainScreen(terminal);

    let controller: controllerTypes.UiController | undefined;
    const agent = startAgent({
      args: [
        cliPath,
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--extension",
        extensionPath,
      ],
      command: "node",
      onExit: handleExit(terminal, () => agent),
      onLine: (line) => {
        const data = parseLine(line);
        if (data !== undefined) controller?.handleAgentEvent(data);
      },
    });

    yield* Effect.sleep(500);
    if (!agent.isRunning()) {
      return fail(`Agent exited immediately. Stderr:\n${agent.stderrText()}`);
    }

    controller = new UiController(
      tui,
      (message) => agent.send(message),
      () => {
        tui.stop();
        process.exit(0);
      },
    );

    showWelcome(controller);
    tui.start();
    return undefined;
  });

Effect.runSync(main());
