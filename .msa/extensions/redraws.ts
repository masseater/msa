import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import { Effect } from "effect";

const { Text } = tuiModule;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerCommand("tui", {
    description: "Show TUI stats",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (!ctx.hasUI) return;
          let redraws = 0;
          yield* Effect.promise(() =>
            ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
              redraws = tui.fullRedraws;
              done(undefined);
              return new Text("", 0, 0);
            }),
          );
          ctx.ui.notify(`TUI full redraws: ${redraws}`, "info");
        }),
      ),
  });
}
