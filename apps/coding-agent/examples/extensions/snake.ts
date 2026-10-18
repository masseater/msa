import type { ExtensionAPI } from "@msa/coding-agent";
import { matchesKey } from "@msa/tui";
import { Effect, type Fiber } from "effect";

import { renderFrame } from "./snake-render.ts";
import { advance, createInitialState, type GameState, TICK_MS } from "./snake-state.ts";

const SNAKE_SAVE_TYPE = "snake-save";

class SnakeComponent {
  private state: GameState;
  private fiber: Fiber.Fiber<never> | undefined;
  private onClose: () => void;
  private onSave: (state: GameState | null) => void;
  private tui: { requestRender: () => void };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private version = 0;
  private cachedVersion = -1;
  private paused: boolean;

  constructor(
    tui: { requestRender: () => void },
    onClose: () => void,
    onSave: (state: GameState | null) => void,
    savedState?: GameState,
  ) {
    this.tui = tui;
    if (savedState !== undefined && !savedState.gameOver) {
      this.state = savedState;
      this.paused = true;
    } else {
      this.state = createInitialState();
      if (savedState !== undefined) {
        this.state.highScore = savedState.highScore;
      }
      this.paused = false;
      this.startGame();
    }
    this.onClose = onClose;
    this.onSave = onSave;
  }

  private startGame(): void {
    const step = Effect.sync(() => {
      if (!this.state.gameOver) {
        advance(this.state);
        this.version++;
        this.tui.requestRender();
      }
    });
    this.fiber = Effect.runFork(Effect.forever(step.pipe(Effect.andThen(Effect.sleep(TICK_MS)))));
  }

  handleInput(data: string): void {
    if (this.paused) {
      if (matchesKey(data, "escape") || data === "q" || data === "Q") {
        this.dispose();
        this.onClose();
        return;
      }

      this.paused = false;
      this.startGame();
      return;
    }

    if (matchesKey(data, "escape")) {
      this.dispose();
      this.onSave(this.state);
      this.onClose();
      return;
    }

    if (data === "q" || data === "Q") {
      this.dispose();
      this.onSave(null);
      this.onClose();
      return;
    }

    if (matchesKey(data, "up") || data === "w" || data === "W") {
      if (this.state.direction !== "down") this.state.nextDirection = "up";
    } else if (matchesKey(data, "down") || data === "s" || data === "S") {
      if (this.state.direction !== "up") this.state.nextDirection = "down";
    } else if (matchesKey(data, "right") || data === "d" || data === "D") {
      if (this.state.direction !== "left") this.state.nextDirection = "right";
    } else if (matchesKey(data, "left") || data === "a" || data === "A") {
      if (this.state.direction !== "right") this.state.nextDirection = "left";
    }

    if (this.state.gameOver && (data === "r" || data === "R" || data === " ")) {
      const highScore = this.state.highScore;
      this.state = createInitialState();
      this.state.highScore = highScore;
      this.onSave(null);
      this.version++;
      this.tui.requestRender();
    }
  }

  invalidate(): void {
    this.cachedWidth = 0;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.version) {
      return this.cachedLines;
    }

    const lines = renderFrame({ state: this.state, paused: this.paused, width });

    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;

    return lines;
  }

  dispose(): void {
    this.fiber?.interruptUnsafe();
    this.fiber = undefined;
  }
}

export default function (msa: ExtensionAPI) {
  msa.registerCommand("snake", {
    description: "Play Snake!",

    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("Snake requires interactive mode", "error");
            return;
          }

          const entries = ctx.sessionManager.getEntries();
          let savedState: GameState | undefined;
          for (const entry of entries.toReversed()) {
            if (entry.type === "custom" && entry.customType === SNAKE_SAVE_TYPE) {
              savedState = entry.data as GameState;
              break;
            }
          }

          yield* Effect.promise(() =>
            ctx.ui.custom(
              (tui, _theme, _kb, done) =>
                new SnakeComponent(
                  tui,
                  () => done(undefined),
                  (state) => {
                    msa.appendEntry(SNAKE_SAVE_TYPE, state);
                  },
                  savedState,
                ),
            ),
          );
        }),
      ),
  });
}
