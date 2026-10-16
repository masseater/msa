/**
 * Redraws Extension
 *
 * Exposes /tui to show TUI redraw stats.
 */

import type { ExtensionAPI } from "@msa/coding-agent";
import { Text } from "@msa/tui";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("tui", {
    description: "Show TUI stats",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      let redraws = 0;
      await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
        redraws = tui.fullRedraws;
        done(undefined);
        return new Text("", 0, 0);
      });
      ctx.ui.notify(`TUI full redraws: ${redraws}`, "info");
    },
  });
}
