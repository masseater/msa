import { Effect } from "effect";
import { dual } from "effect/Function";

import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import effectHelpers from "./effect-helpers.ts";
import EmptyContent from "./overlay-non-capturing-empty-content.ts";
import type overlayNonCapturingHelpersTypes from "./overlay-non-capturing-helpers.types.ts";
import VirtualTerminal from "./virtual-terminal.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

const { nextTick } = effectHelpers;
const renderAndFlush: {
  (tui: tuiInterfaceTypes.TUI, terminal: virtualTerminalTypes.VirtualTerminal): Effect.Effect<void>;
  (
    terminal: virtualTerminalTypes.VirtualTerminal,
  ): (tui: tuiInterfaceTypes.TUI) => Effect.Effect<void>;
} = dual(
  2,
  (
    tui: tuiInterfaceTypes.TUI,
    terminal: virtualTerminalTypes.VirtualTerminal,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      tui.requestRender(true);
    }).pipe(
      Effect.andThen(nextTick),
      Effect.andThen(Effect.promise(() => terminal.waitForRender())),
    ),
);

const withOverlayTui: {
  (
    setup: overlayNonCapturingHelpersTypes.OverlayTuiSetup,
    body: (context: overlayNonCapturingHelpersTypes.OverlayTuiContext) => Effect.Effect<void>,
  ): Effect.Effect<void>;
  (
    body: (context: overlayNonCapturingHelpersTypes.OverlayTuiContext) => Effect.Effect<void>,
  ): (setup: overlayNonCapturingHelpersTypes.OverlayTuiSetup) => Effect.Effect<void>;
} = dual(
  2,
  (
    setup: overlayNonCapturingHelpersTypes.OverlayTuiSetup,
    body: (context: overlayNonCapturingHelpersTypes.OverlayTuiContext) => Effect.Effect<void>,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      const terminal = new VirtualTerminal(setup.width ?? 80, setup.height ?? 24);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
      tui.addChild(setup.root ?? new EmptyContent());
      if (setup.focus !== undefined) tui.setFocus(setup.focus);
      tui.start();
      return body({ terminal, tui }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            tui.stop();
          }),
        ),
      );
    }),
);

const overlayNonCapturingHelpers = {
  renderAndFlush,
  withOverlayTui,
};

export default overlayNonCapturingHelpers;
