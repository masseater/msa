import { Effect } from "effect";
import { dual } from "effect/Function";

import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const OSC133_ZONE_START = "\x1b]133;A\x07";

export const scrollLineByLine: {
  (tui: TuiAltScreen, terminal: VirtualTerminal, steps: number): Effect.Effect<void>;
  (terminal: VirtualTerminal, steps: number): (tui: TuiAltScreen) => Effect.Effect<void>;
} = dual(3, (tui: TuiAltScreen, terminal: VirtualTerminal, steps: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let step = 0; step < steps; step++) {
      tui.scrollBy(1);
      yield* Effect.promise(() => terminal.waitForRender());
    }
  }),
);
