import { Effect } from "effect";
import { dual } from "effect/Function";

import type { TUI } from "../src/tui.ts";
import { nextTick } from "./effect-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const renderAndFlush: {
  (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void>;
  (terminal: VirtualTerminal): (tui: TUI) => Effect.Effect<void>;
} = dual(2, (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.sync(() => {
    tui.requestRender(true);
  }).pipe(Effect.andThen(nextTick), Effect.andThen(Effect.promise(() => terminal.waitForRender()))),
);
