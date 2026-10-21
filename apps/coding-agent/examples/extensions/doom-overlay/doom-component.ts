import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, type Fiber } from "effect";

import type doomEngineTypes from "./doom-engine.types.ts";
import doomKeysModule from "./doom-keys.ts";

const { DoomKeys, mapKeyToDoom } = doomKeysModule;

const { isKeyRelease } = tuiModule;

function renderHalfBlock(
  rgba: Uint8Array,
  width: number,
  height: number,
  targetCols: number,
  targetRows: number,
): string[] {
  const lines: string[] = [];
  const scaleX = width / targetCols;
  const scaleY = height / (targetRows * 2);

  for (let row = 0; row < targetRows; row++) {
    let line = "";
    const srcY1 = Math.floor(row * 2 * scaleY);
    const srcY2 = Math.floor((row * 2 + 1) * scaleY);

    for (let col = 0; col < targetCols; col++) {
      const srcX = Math.floor(col * scaleX);
      const idx1 = (srcY1 * width + srcX) * 4;
      const idx2 = (srcY2 * width + srcX) * 4;
      const r1 = rgba[idx1] ?? 0;
      const g1 = rgba[idx1 + 1] ?? 0;
      const b1 = rgba[idx1 + 2] ?? 0;
      const r2 = rgba[idx2] ?? 0;
      const g2 = rgba[idx2 + 1] ?? 0;
      const b2 = rgba[idx2 + 2] ?? 0;
      line += `\x1b[38;2;${r1};${g1};${b1}m\x1b[48;2;${r2};${g2};${b2}m▀`;
    }
    line += "\x1b[0m";
    lines.push(line);
  }
  return lines;
}

export default class DoomOverlayComponent implements tuiTypes.Component {
  private engine: doomEngineTypes.DoomEngine;
  private tui: tuiTypes.TUI;
  private fiber: Fiber.Fiber<void> | undefined;
  private onExit: () => void;

  wantsKeyRelease = true;

  constructor(
    tui: tuiTypes.TUI,
    engine: doomEngineTypes.DoomEngine,
    onExit: () => void,
    resume = false,
  ) {
    this.tui = tui;
    this.engine = engine;
    this.onExit = onExit;

    if (resume) {
      this.engine.pushKey(true, DoomKeys.KEY_PAUSE);
      this.engine.pushKey(false, DoomKeys.KEY_PAUSE);
    }

    this.startGameLoop();
  }

  private startGameLoop(): void {
    const tick = Effect.sync(() => {
      try {
        this.engine.tick();
        this.tui.requestRender();
      } catch {
        this.dispose();
        this.onExit();
      }
    });
    this.fiber = Effect.runFork(Effect.forever(tick.pipe(Effect.andThen(Effect.sleep(1000 / 35)))));
  }

  handleInput(data: string): void {
    if (!isKeyRelease(data) && (data === "q" || data === "Q")) {
      this.engine.pushKey(true, DoomKeys.KEY_PAUSE);
      this.engine.pushKey(false, DoomKeys.KEY_PAUSE);
      this.dispose();
      this.onExit();
      return;
    }

    const doomKeys = mapKeyToDoom(data);
    if (doomKeys.length === 0) return;

    const released = isKeyRelease(data);

    for (const key of doomKeys) {
      this.engine.pushKey(!released, key);
    }
  }

  render(width: number): string[] {
    const ASPECT_RATIO = 3.2;
    const MIN_HEIGHT = 10;
    const height = Math.max(MIN_HEIGHT, Math.floor(width / ASPECT_RATIO));

    const rgba = this.engine.getFrameRGBA();
    const lines = renderHalfBlock(rgba, this.engine.width, this.engine.height, width, height);

    const footer =
      " DOOM | Q=Pause | WASD=Move | Shift+WASD=Run | Space=Use | F=Fire | 1-7=Weapons";
    const truncatedFooter = footer.length > width ? footer.slice(0, width) : footer;
    lines.push(`\x1b[2m${truncatedFooter}\x1b[0m`);

    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.fiber?.interruptUnsafe();
    this.fiber = undefined;
  }
}
