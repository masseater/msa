import { NodeServices } from "@effect/platform-node";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, ManagedRuntime, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey, truncateToWidth, visibleWidth } = tuiModule;

const runtime = ManagedRuntime.make(NodeServices.layer);

const STREAM_SCRIPT = `
			echo "Starting streaming overflow test (30+ seconds)..."
			echo "This simulates subagent output with colors, hyperlinks, and long paths"
			echo ""
			for i in $(seq 1 100); do
				DIR="/Users/nicobailon/Documents/development/msa-mono/apps/coding-agent/src/modes/interactive"
				FILE="\${DIR}/components/very-long-component-name-that-exceeds-width-\${i}.ts"
				echo -e "\\033]8;;file://\${FILE}\\007▶ read: \${FILE}\\033]8;;\\007"
				if [ $((i % 5)) -eq 0 ]; then
					echo -e "  \\033[32m✓ Successfully processed \${i} files in /Users/nicobailon/Documents/development/msa-mono\\033[0m"
				fi
				if [ $((i % 7)) -eq 0 ]; then
					echo -e "  \\033[33m⚠ Warning: potential issue detected at line \${i} in very-long-component-name-that-exceeds-width.ts\\033[0m"
				fi
				if [ $((i % 11)) -eq 0 ]; then
					echo -e "  \\033[31m✗ Error: file not found /some/really/long/path/that/definitely/exceeds/the/overlay/width/limit/file-\${i}.ts\\033[0m"
				fi
				sleep 0.3
			done
			echo ""
			echo -e "\\033[32m✓ Complete - 100 files processed in 30 seconds\\033[0m"
			echo "Press Esc to close"
			`;

export default class StreamingOverflowComponent extends BaseOverlay {
  private tui: tuiTypes.TUI;
  private lines: string[] = [];
  private fiber: { interruptUnsafe: () => void } | undefined;
  private scrollOffset = 0;
  private maxVisibleLines = 15;
  private finished = false;
  private disposed = false;
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: codingAgentTypes.Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.startProcess();
  }

  private startProcess(): void {
    const self = this;
    this.fiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const handle = yield* spawner.spawn(
            ChildProcess.make("bash", ["-c", STREAM_SCRIPT], { stdin: "ignore" }),
          );

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.splitLines(Stream.decodeText(handle.stdout)), (line) =>
              Effect.sync(() => self.appendLine(line)),
            ),
          );
          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.stderr), (chunk) =>
              Effect.sync(() => self.appendError(chunk)),
            ),
          );

          yield* handle.exitCode;
          yield* Effect.sync(() => self.markFinished());
        }),
      ).pipe(Effect.ignore),
    );
  }

  private appendLine(line: string): void {
    if (this.disposed || line.length === 0) return;
    this.lines.push(line);
    this.scrollOffset = Math.max(0, this.lines.length - this.maxVisibleLines);
    this.tui.requestRender();
  }

  private appendError(chunk: string): void {
    if (this.disposed) return;
    this.lines.push(this.theme.fg("error", chunk.trim()));
    this.tui.requestRender();
  }

  private markFinished(): void {
    if (this.disposed) return;
    this.finished = true;
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.fiber?.interruptUnsafe();
      this.done();
    } else if (matchesKey(data, "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "down")) {
      this.scrollOffset = Math.min(
        Math.max(0, this.lines.length - this.maxVisibleLines),
        this.scrollOffset + 1,
      );
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const border = (c: string) => th.fg("border", c);

    const result: string[] = [];
    const title = truncateToWidth(` Streaming Output (${this.lines.length} lines) `, innerW);
    const titlePad = Math.max(0, innerW - visibleWidth(title));
    result.push(border("╭") + th.fg("accent", title) + border(`${"─".repeat(titlePad)}╮`));

    const canScrollUp = this.scrollOffset > 0;
    const canScrollDown = this.scrollOffset < this.lines.length - this.maxVisibleLines;
    const scrollInfo = `↑${this.scrollOffset} | ↓${Math.max(0, this.lines.length - this.maxVisibleLines - this.scrollOffset)}`;

    result.push(
      border("│") +
        padLine(canScrollUp || canScrollDown ? th.fg("dim", ` ${scrollInfo}`) : "") +
        border("│"),
    );

    const visibleLines = this.lines.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisibleLines,
    );
    for (const line of visibleLines) {
      result.push(border("│") + padLine(` ${line}`) + border("│"));
    }

    for (let i = visibleLines.length; i < this.maxVisibleLines; i++) {
      result.push(border("│") + padLine("") + border("│"));
    }

    const status = this.finished ? th.fg("success", "✓ Done") : th.fg("warning", "● Running");
    result.push(
      border("│") + padLine(` ${status} ${th.fg("dim", "| ↑↓ scroll | Esc close")}`) + border("│"),
    );
    result.push(border(`╰${"─".repeat(innerW)}╯`));

    return result;
  }

  override dispose(): void {
    this.disposed = true;
    this.fiber?.interruptUnsafe();
  }
}
