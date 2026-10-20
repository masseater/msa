import type tuiTypes from "@msa/tui/index.types";

import platform from "../../../core/platform.ts";
import type platformTypes from "../../../core/platform.types.ts";
import intervalModule from "../../interval.ts";
import themeModule from "../theme/theme.ts";
import arminHelpers from "./armin-helpers.ts";
import type arminInternalTypes from "./armin-internal.types.ts";
import ArminEffects from "./armin/armin-effects.ts";

const { theme } = themeModule;
const { randomUnit } = platform;
const { every } = intervalModule;
const { EFFECTS, buildFinalGrid } = arminHelpers;

export default class ArminComponent implements tuiTypes.Component {
  readonly effects: ArminEffects;

  private ui!: tuiTypes.TUI;

  private interval: platformTypes.Scheduled | null = null;

  effect!: arminInternalTypes.Effect;

  finalGrid!: string[][];

  currentGrid!: string[][];

  effectState: Record<string, unknown> = {};

  private cachedLines: string[] = [];

  private cachedWidth = 0;

  private gridVersion = 0;

  private cachedVersion = -1;

  invalidate(): void {
    this.cachedWidth = 0;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.gridVersion) {
      return this.cachedLines;
    }

    const padding = 1;
    const availableWidth = width - padding;

    this.cachedLines = this.currentGrid.map((row) => {
      const clipped = row.slice(0, availableWidth).join("");
      const padRight = Math.max(0, width - padding - clipped.length);
      return ` ${theme.fg("accent", clipped)}${" ".repeat(padRight)}`;
    });

    const message = "ARMIN SAYS HI";
    const msgPadRight = Math.max(0, width - padding - message.length);
    this.cachedLines.push(` ${theme.fg("accent", message)}${" ".repeat(msgPadRight)}`);

    this.cachedWidth = width;
    this.cachedVersion = this.gridVersion;

    return this.cachedLines;
  }

  private startAnimation(): void {
    const fps = this.effect === "glitch" ? 60 : 30;
    this.interval = every(() => {
      const done = this.effects.tickEffect();
      this.updateDisplay();
      this.ui.requestRender();
      if (done) {
        this.stopAnimation();
      }
    }, 1000 / fps);
  }

  private stopAnimation(): void {
    if (this.interval !== null) {
      this.interval.cancel();
      this.interval = null;
    }
  }

  private updateDisplay(): void {
    this.gridVersion++;
  }

  constructor(ui: tuiTypes.TUI) {
    this.effects = new ArminEffects(this);
    this.ui = ui;
    this.effect = EFFECTS[Math.floor(randomUnit() * EFFECTS.length)] ?? "typewriter";
    this.finalGrid = buildFinalGrid();
    this.currentGrid = this.effects.createEmptyGrid();

    this.effects.initEffect();
    this.startAnimation();
  }
}
