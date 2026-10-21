import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import { Effect, type Fiber } from "effect";

import spaceInvadersRender from "./space-invaders-render.ts";
import spaceInvadersState from "./space-invaders-state.ts";
import type spaceInvadersStateTypes from "./space-invaders-state.types.ts";

const { TICK_MS, advance, createInitialState } = spaceInvadersState;
const { renderFrame } = spaceInvadersRender;

const { Key, isKeyRelease, matchesKey } = tuiModule;

const INVADERS_SAVE_TYPE = "space-invaders-save";

type KeyAction = "close" | "save" | "discard" | "resume" | "restart" | "none";

const isLeft = (data: string): boolean =>
  matchesKey(data, Key.left) || data === "a" || data === "A" || matchesKey(data, "a");

const isRight = (data: string): boolean =>
  matchesKey(data, Key.right) || data === "d" || data === "D" || matchesKey(data, "d");

const isFire = (data: string): boolean =>
  matchesKey(data, Key.space) ||
  data === " " ||
  data === "f" ||
  data === "F" ||
  matchesKey(data, "f");

const pausedAction = (data: string, released: boolean): KeyAction => {
  if (released) return "none";
  if (matchesKey(data, Key.escape) || data === "q" || data === "Q") return "close";
  return "resume";
};

const playingAction = (
  data: string,
  released: boolean,
  state: spaceInvadersStateTypes.GameState,
): KeyAction => {
  if (!released && matchesKey(data, Key.escape)) return "save";
  if (!released && (data === "q" || data === "Q")) return "discard";
  if (!released && (state.gameOver || state.victory)) {
    if (data === "r" || data === "R" || data === " ") return "restart";
  }
  return "none";
};

class SpaceInvadersComponent {
  private state: spaceInvadersStateTypes.GameState;
  private keys: spaceInvadersStateTypes.KeyState = { fire: false, left: false, right: false };
  private counters: spaceInvadersStateTypes.Counters = { fireCooldown: 0, playerMoveCounter: 0 };
  private fiber: Fiber.Fiber<never> | undefined;
  private onClose: () => void;
  private onSave: (state: spaceInvadersStateTypes.GameState | null) => void;
  private tui: { requestRender: () => void };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private version = 0;
  private cachedVersion = -1;
  private paused: boolean;

  wantsKeyRelease = true;

  constructor(
    tui: { requestRender: () => void },
    onClose: () => void,
    onSave: (state: spaceInvadersStateTypes.GameState | null) => void,
    savedState?: spaceInvadersStateTypes.GameState,
  ) {
    this.tui = tui;
    if (savedState !== undefined && !savedState.gameOver && !savedState.victory) {
      this.state = savedState;
      this.paused = true;
    } else {
      this.state = createInitialState({ highScore: savedState?.highScore });
      this.paused = false;
      this.startGame();
    }
    this.onClose = onClose;
    this.onSave = onSave;
  }

  private startGame(): void {
    const step = Effect.sync(() => {
      if (this.state.gameOver || this.state.victory) return;
      advance({ counters: this.counters, keys: this.keys, state: this.state });
      this.version++;
      this.tui.requestRender();
    });
    this.fiber = Effect.runFork(Effect.forever(step.pipe(Effect.andThen(Effect.sleep(TICK_MS)))));
  }

  private restart(): void {
    const highScore = this.state.highScore;
    const nextLevel = this.state.victory ? this.state.level + 1 : 1;
    this.state = createInitialState({ highScore, level: nextLevel });
    this.keys = { fire: false, left: false, right: false };
    this.counters = { fireCooldown: 0, playerMoveCounter: 0 };
    this.onSave(null);
    this.version++;
    this.tui.requestRender();
  }

  private applyAction(action: KeyAction): void {
    switch (action) {
      case "close":
        this.dispose();
        this.onClose();
        return;
      case "save":
        this.dispose();
        this.onSave(this.state);
        this.onClose();
        return;
      case "discard":
        this.dispose();
        this.onSave(null);
        this.onClose();
        return;
      case "resume":
        this.paused = false;
        this.startGame();
        return;
      case "restart":
        this.restart();
    }
  }

  handleInput(data: string): void {
    const released = isKeyRelease(data);

    if (this.paused) {
      this.applyAction(pausedAction(data, released));
      return;
    }

    this.applyAction(playingAction(data, released, this.state));

    if (isLeft(data)) this.keys.left = !released;
    if (isRight(data)) this.keys.right = !released;
    if (isFire(data)) this.keys.fire = !released;
  }

  invalidate(): void {
    this.cachedWidth = 0;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.version) {
      return this.cachedLines;
    }

    const lines = renderFrame({ paused: this.paused, state: this.state, width });

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

const findSavedState = (
  entries: ReturnType<codingAgentTypes.ExtensionContext["sessionManager"]["getEntries"]>,
): spaceInvadersStateTypes.GameState | undefined => {
  for (const entry of entries.toReversed()) {
    if (entry.type === "custom" && entry.customType === INVADERS_SAVE_TYPE) {
      return entry.data as spaceInvadersStateTypes.GameState;
    }
  }
  return undefined;
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerCommand("invaders", {
    description: "Play Space Invaders!",

    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("Space Invaders requires interactive mode", "error");
            return;
          }

          const savedState = findSavedState(ctx.sessionManager.getEntries());

          yield* Effect.promise(() =>
            ctx.ui.custom(
              (tui, _theme, _kb, done) =>
                new SpaceInvadersComponent(
                  tui,
                  () => done(undefined),
                  (state) => {
                    msa.appendEntry(INVADERS_SAVE_TYPE, state);
                  },
                  savedState,
                ),
            ),
          );
        }),
      ),
  });
}
