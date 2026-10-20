import type tuiTypes from "@msa/tui/index.types";
import { Effect, type Fiber } from "effect";

import { BLUE, BOLD, DIM, RESET } from "./colors.ts";

export class LoadingIndicator implements tuiTypes.Component {
  private dots = 1;
  private fiber: Fiber.Fiber<never> | undefined;
  private tui: tuiTypes.TUI | null = null;

  start(tui: tuiTypes.TUI): void {
    this.tui = tui;
    this.dots = 1;
    this.fiber = Effect.runFork(
      Effect.forever(
        Effect.sync(() => {
          this.dots = (this.dots % 3) + 1;
          this.tui?.requestRender();
        }).pipe(Effect.andThen(Effect.sleep(400))),
      ),
    );
  }

  stop(): void {
    this.fiber?.interruptUnsafe();
    this.fiber = undefined;
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return [`${BLUE}${BOLD}Agent:${RESET} ${DIM}Working${".".repeat(this.dots)}${RESET}`];
  }
}
