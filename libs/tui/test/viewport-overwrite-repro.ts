import { Effect } from "effect";

import { ProcessTerminal } from "../src/terminal.ts";
import type { Component } from "../src/tui-component.ts";
import type { TUI } from "../src/tui-interface.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

class Lines implements Component {
  private lines: string[] = [];

  set(lines: string[]): void {
    this.lines = lines;
  }

  append(lines: string[]): void {
    this.lines.push(...lines);
  }

  render(width: number): string[] {
    return this.lines.map((line) => {
      if (line.length > width) return line.slice(0, width);
      return line.padEnd(width, " ");
    });
  }

  invalidate(): void {}
}

function streamLines(
  buffer: Lines,
  label: string,
  count: number,
  delayMs: number,
  ui: TUI,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let i = 1; i <= count; i++) {
      buffer.append([`${label} ${String(i).padStart(2, "0")}`]);
      ui.requestRender();
      yield* Effect.sleep(delayMs);
    }
  });
}

const main = Effect.gen(function* () {
  const ui: TUI = new TuiMainScreen(new ProcessTerminal());
  const buffer = new Lines();
  ui.addChild(buffer);
  ui.start();

  const height = ui.terminal.rows;
  const preCount = height + 8;
  const toolCount = height + 12;
  const postCount = 6;

  buffer.set([
    "TUI viewport overwrite repro",
    `Viewport rows detected: ${height}`,
    "(Resize to ~8-12 rows for best repro)",
    "",
    "=== PRE-TOOL STREAM ===",
  ]);
  ui.requestRender();
  yield* Effect.sleep(300);

  yield* streamLines(buffer, "PRE-TOOL LINE", preCount, 30, ui);

  buffer.append(["", "--- TOOL CALL START ---", "(pause...)", ""]);
  ui.requestRender();
  yield* Effect.sleep(700);

  yield* streamLines(buffer, "TOOL OUT", toolCount, 20, ui);

  buffer.append(["", "=== POST-TOOL STREAM ==="]);
  ui.requestRender();
  yield* Effect.sleep(300);
  yield* streamLines(buffer, "POST-TOOL LINE", postCount, 40, ui);

  yield* Effect.sleep(1500);
  ui.stop();
});

Effect.runPromise(main).catch((error: unknown) => {
  try {
    const ui: TUI = new TuiMainScreen(new ProcessTerminal());
    ui.stop();
  } catch {}
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
