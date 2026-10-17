import { Effect } from "effect";
import { dual } from "effect/Function";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type Component, type TUI } from "../src/tui.ts";
import { nextTick } from "./effect-helpers.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const renderAndFlush: {
  (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void>;
  (terminal: VirtualTerminal): (tui: TUI) => Effect.Effect<void>;
} = dual(2, (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.sync(() => {
    tui.requestRender(true);
  }).pipe(Effect.andThen(nextTick), Effect.andThen(Effect.promise(() => terminal.waitForRender()))),
);

export interface OverlayTuiContext {
  readonly tui: TUI;
  readonly terminal: VirtualTerminal;
}

export interface OverlayTuiSetup {
  readonly focus?: Component;
  readonly width?: number;
  readonly height?: number;
}

export const withOverlayTui: {
  (
    setup: OverlayTuiSetup,
    body: (context: OverlayTuiContext) => Effect.Effect<void>,
  ): Effect.Effect<void>;
  (
    body: (context: OverlayTuiContext) => Effect.Effect<void>,
  ): (setup: OverlayTuiSetup) => Effect.Effect<void>;
} = dual(
  2,
  (
    setup: OverlayTuiSetup,
    body: (context: OverlayTuiContext) => Effect.Effect<void>,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      const terminal = new VirtualTerminal(setup.width ?? 80, setup.height ?? 24);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.addChild(new EmptyContent());
      if (setup.focus !== undefined) tui.setFocus(setup.focus);
      tui.start();
      return body({ tui, terminal }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            tui.stop();
          }),
        ),
      );
    }),
);
