import { Effect } from "effect";
import { dual } from "effect/Function";

import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import effectHelpers from "./effect-helpers.ts";
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

export default renderAndFlush;
