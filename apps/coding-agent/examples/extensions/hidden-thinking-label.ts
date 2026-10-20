import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

const DEFAULT_LABEL = "Pondering...";

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let label = DEFAULT_LABEL;

  const applyLabel = (ctx: codingAgentTypes.ExtensionContext) => {
    ctx.ui.setHiddenThinkingLabel(label);
  };

  msa.on("session_start", (_event, ctx) => {
    applyLabel(ctx);
  });

  msa.registerCommand("thinking-label", {
    description: "Set the hidden thinking label. Use without args to reset.",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const nextLabel = args.trim();

          if (nextLabel.length === 0) {
            label = DEFAULT_LABEL;
            ctx.ui.setHiddenThinkingLabel();
            ctx.ui.notify(`Hidden thinking label reset to: ${DEFAULT_LABEL}`);
            return;
          }

          label = nextLabel;
          ctx.ui.setHiddenThinkingLabel(label);
          ctx.ui.notify(`Hidden thinking label set to: ${label}`);
        }),
      ),
  });
}
