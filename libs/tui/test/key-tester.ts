import { Console, Effect } from "effect";

import delay from "../src/delay.ts";
import keys from "../src/keys.ts";
import ProcessTerminal from "../src/terminal.ts";
import type terminalTypes from "../src/terminal.types.ts";
import textTruncate from "../src/text-truncate.ts";
import type tuiComponentTypes from "../src/tui-component.types.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";

const { matchesKey } = keys;
const { truncateToWidth } = textTruncate;

const { runEvery } = delay;

const CONTROL_NAMES = new Map([
  ["\u001b", "\\x1b"],
  ["\r", "\\r"],
  ["\n", "\\n"],
  ["\t", "\\t"],
  ["\u007f", "\\x7f"],
]);

class KeyLogger implements tuiComponentTypes.Component {
  private log: string[] = [];
  private maxLines = 20;
  private tui: tuiInterfaceTypes.TUI;
  private terminal: terminalTypes.ProcessTerminal;

  constructor(tui: tuiInterfaceTypes.TUI, terminal: terminalTypes.ProcessTerminal) {
    this.tui = tui;
    this.terminal = terminal;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+c")) {
      this.tui.stop();
      Effect.runSync(Console.log("\nExiting..."));
      process.exit(0);
    }

    const hex = Buffer.from(data).toString("hex");
    const charCodes = Array.from(data)
      .map((c) => c.charCodeAt(0))
      .join(", ");
    const repr = Array.from(data)
      .map((character) => CONTROL_NAMES.get(character) ?? character)
      .join("");

    const logLine = `Hex: ${hex.padEnd(20)} | Chars: [${charCodes.padEnd(15)}] | Repr: "${repr}"`;

    this.log.push(logLine);

    if (this.log.length > this.maxLines) {
      this.log.shift();
    }

    this.tui.requestRender();
  }

  invalidate(): void {}

  private protocolName(): string {
    if (this.terminal.kittyProtocolActive) return "kitty";
    if (this.terminal.modifyOtherKeysActive) return "modifyOtherKeys";
    return "legacy";
  }

  private fit(line: string, width: number): string {
    return truncateToWidth(line, width).padEnd(width);
  }

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push("=".repeat(width));
    lines.push(this.fit("Key Code Tester - Press keys to see their codes (Ctrl+C to exit)", width));
    lines.push(this.fit(`Protocol: ${this.protocolName()}`, width));
    lines.push("=".repeat(width));
    lines.push("");

    for (const entry of this.log) {
      lines.push(this.fit(entry, width));
    }

    const remaining = Math.max(0, 25 - lines.length);
    for (let i = 0; i < remaining; i++) {
      lines.push("".padEnd(width));
    }

    lines.push("=".repeat(width));
    lines.push(this.fit("Test these:", width));
    lines.push(this.fit("  - Shift + Enter (should show: \\x1b[13;2u with Kitty protocol)", width));
    lines.push(this.fit("  - Alt/Option + Enter", width));
    lines.push(this.fit("  - Option/Alt + Backspace", width));
    lines.push(this.fit("  - Cmd/Ctrl + Backspace", width));
    lines.push(this.fit("  - Regular Backspace", width));
    lines.push("=".repeat(width));

    return lines;
  }
}

const terminal = new ProcessTerminal();
const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
const logger = new KeyLogger(tui, terminal);

tui.addChild(logger);
tui.setFocus(logger);

process.on("SIGINT", () => {
  tui.stop();
  Effect.runSync(Console.log("\nExiting..."));
  process.exit(0);
});

tui.start();

runEvery(100, () => tui.requestRender());
