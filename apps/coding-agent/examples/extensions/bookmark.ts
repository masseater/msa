import type { ExtensionAPI } from "@msa/coding-agent";
import { Clock, Effect } from "effect";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("bookmark", {
    description: "Bookmark last message (usage: /bookmark [label])",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const label = args.trim() || `bookmark-${Effect.runSync(Clock.currentTimeMillis)}`;

          const entries = ctx.sessionManager.getEntries();
          for (const entry of entries.toReversed()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              msa.setLabel(entry.id, label);
              ctx.ui.notify(`Bookmarked as: ${label}`, "info");
              return;
            }
          }

          ctx.ui.notify("No assistant message to bookmark", "warning");
        }),
      ),
  });

  msa.registerCommand("unbookmark", {
    description: "Remove bookmark from last labeled entry",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const entries = ctx.sessionManager.getEntries();
          for (const entry of entries.toReversed()) {
            const label = ctx.sessionManager.getLabel(entry.id);
            if (label !== undefined && label.length > 0) {
              msa.setLabel(entry.id, undefined);
              ctx.ui.notify(`Removed bookmark: ${label}`, "info");
              return;
            }
          }
          ctx.ui.notify("No bookmarked entry found", "warning");
        }),
      ),
  });
}
