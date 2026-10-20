import type { Theme } from "@msa/coding-agent";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Clock, Effect, type Fiber } from "effect";

import { BaseOverlay } from "./base-overlay.ts";
import { hslToRgb } from "./hsl-to-rgb.ts";

const { matchesKey, truncateToWidth } = tuiModule;

export class AnimationDemoComponent extends BaseOverlay {
  private tui: tuiTypes.TUI;
  private frame = 0;
  private fiber: Fiber.Fiber<never> | undefined;
  private fps = 0;
  private lastFpsUpdate = Effect.runSync(Clock.currentTimeMillis);
  private framesSinceLastFps = 0;
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.startAnimation();
  }

  private startAnimation(): void {
    const self = this;
    this.fiber = Effect.runFork(
      Effect.forever(
        Effect.gen(function* () {
          self.frame++;
          self.framesSinceLastFps++;

          const now = yield* Clock.currentTimeMillis;
          if (now - self.lastFpsUpdate >= 1000) {
            self.fps = self.framesSinceLastFps;
            self.framesSinceLastFps = 0;
            self.lastFpsUpdate = now;
          }

          self.tui.requestRender();
          yield* Effect.sleep(1000 / 30);
        }),
      ),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.dispose();
      this.done();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const border = (c: string) => th.fg("border", c);

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(border("│") + padLine(th.fg("accent", " Animation Demo (~30 FPS)")) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(
      border("│") + padLine(` Frame: ${th.fg("accent", String(this.frame))}`) + border("│"),
    );
    lines.push(border("│") + padLine(` FPS: ${th.fg("success", String(this.fps))}`) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));

    const barWidth = Math.max(12, innerW - 4);
    const pos = Math.max(0, Math.floor(((Math.sin(this.frame / 10) + 1) * (barWidth - 10)) / 2));
    const bar =
      " ".repeat(pos) +
      th.fg("accent", "██████████") +
      " ".repeat(Math.max(0, barWidth - 10 - pos));
    lines.push(border("│") + padLine(` ${bar}`) + border("│"));

    const spinChars = ["◐", "◓", "◑", "◒"];
    const spin = spinChars[this.frame % spinChars.length];
    lines.push(border("│") + padLine(` Spinner: ${th.fg("warning", spin!)}`) + border("│"));

    const hue = (this.frame * 3) % 360;
    const rgb = hslToRgb({ h: hue / 360, l: 0.5, s: 0.8 });
    const colorBlock = `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${"  ".repeat(10)}\x1b[0m`;
    lines.push(border("│") + padLine(` Color: ${colorBlock}`) + border("│"));

    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(
      border("│") + padLine(th.fg("dim", " This proves overlays can handle")) + border("│"),
    );
    lines.push(
      border("│") + padLine(th.fg("dim", " real-time game-like rendering.")) + border("│"),
    );
    lines.push(border("│") + padLine(th.fg("dim", " (msa-doom uses same approach)")) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Press Esc to close")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  override dispose(): void {
    this.fiber?.interruptUnsafe();
    this.fiber = undefined;
  }
}
