import type { Theme } from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { DateTime, Effect, type Fiber } from "effect";

import { BaseOverlay } from "./base-overlay.ts";
import { StreamingInputPanel } from "./streaming-input-panel.ts";

const { matchesKey } = tuiModule;

export class StreamingInputController extends BaseOverlay {
  private tui: tuiTypes.TUI;
  private panels: StreamingInputPanel[] = [];
  private handles: tuiTypes.OverlayHandle[] = [];
  private focusIndex = -1;
  private streamLines: string[] = [];
  private streamFiber: Fiber.Fiber<never> | undefined;
  private lineCount = 0;
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;

    const colors = ["error", "success", "accent"] as const;
    const labels = ["Panel A", "Panel B", "Panel C"];

    for (let i = 0; i < 3; i++) {
      const panel = new StreamingInputPanel(
        theme,
        labels[i]!,
        colors[i]!,
        () => this.cycleFocus(),
        () => this.close(),
      );
      const handle = this.tui.showOverlay(panel, {
        col: 2,
        nonCapturing: true,
        row: 1 + i * 9,
        width: 35,
      });
      panel.handle = handle;
      this.panels.push(panel);
      this.handles.push(handle);
    }

    const self = this;
    this.streamFiber = Effect.runFork(
      Effect.forever(
        Effect.gen(function* () {
          self.lineCount++;
          const timestamp = DateTime.formatLocal(DateTime.nowUnsafe());
          self.streamLines.push(`[${timestamp}] Streaming line ${self.lineCount}...`);
          if (self.streamLines.length > 8) {
            self.streamLines.shift();
          }
          self.tui.requestRender();
          yield* Effect.sleep(500);
        }),
      ),
    );
  }

  private cycleFocus(): void {
    if (this.focusIndex >= 0 && this.focusIndex < this.handles.length) {
      this.handles[this.focusIndex]!.unfocus();
    }

    this.focusIndex++;
    if (this.focusIndex >= this.handles.length) {
      this.focusIndex = -1;
    }

    if (this.focusIndex >= 0) {
      this.handles[this.focusIndex]!.focus();
    }

    this.tui.requestRender();
  }

  private close(): void {
    this.streamFiber?.interruptUnsafe();
    this.streamFiber = undefined;
    for (const handle of this.handles) handle.hide();
    this.handles = [];
    this.panels = [];
    this.done();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.close();
    } else if (matchesKey(data, "tab")) {
      this.cycleFocus();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const focusedLabel =
      this.focusIndex === -1
        ? th.fg("success", "Controller (this panel)")
        : (this.panels[this.focusIndex]?.label ?? "?");

    const lines = [
      "",
      ` Current focus: ${th.fg("accent", focusedLabel)}`,
      "",
      " Simulated streaming output:",
      th.fg("dim", " ─".repeat((width - 2) / 2)),
    ];

    for (const line of this.streamLines) {
      lines.push(` ${th.fg("dim", line)}`);
    }

    while (lines.length < 12) {
      lines.push("");
    }

    lines.push(th.fg("dim", " ─".repeat((width - 2) / 2)));
    lines.push("");
    lines.push(` Three ${th.fg("accent", "nonCapturing")} input panels on the left.`);
    lines.push(" Tab cycles: Controller → Panel A → B → C → Controller");
    lines.push(" Type in each panel to test input routing.");
    lines.push("");
    lines.push(th.fg("dim", " Tab = cycle focus | Esc = close all"));
    lines.push("");

    return this.box(lines, width, "Streaming + Input Test");
  }

  override dispose(): void {
    this.close();
  }
}
