import type codingAgentTypes from "@msa/coding-agent/index.types";

const COMPACT_THRESHOLD_TOKENS = 100_000;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let previousTokens: number | null | undefined;

  const triggerCompaction = (
    ctx: codingAgentTypes.ExtensionContext,
    customInstructions?: string,
  ) => {
    if (ctx.hasUI) {
      ctx.ui.notify("Compaction started", "info");
    }
    ctx.compact({
      ...(customInstructions === undefined ? {} : { customInstructions }),
      onComplete: () => {
        if (ctx.hasUI) {
          ctx.ui.notify("Compaction completed", "info");
        }
      },
      onError: (error) => {
        if (ctx.hasUI) {
          ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
        }
      },
    });
  };

  msa.on("turn_end", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    const currentTokens = usage?.tokens ?? null;
    if (currentTokens === null) {
      return;
    }

    const crossedThreshold =
      previousTokens !== undefined &&
      previousTokens !== null &&
      previousTokens <= COMPACT_THRESHOLD_TOKENS;
    previousTokens = currentTokens;
    if (!crossedThreshold || currentTokens <= COMPACT_THRESHOLD_TOKENS) {
      return;
    }
    triggerCompaction(ctx);
  });

  helperPart1(msa, triggerCompaction);
}

function helperPart1(
  msa: codingAgentTypes.ExtensionAPI,
  triggerCompaction: (ctx: codingAgentTypes.ExtensionContext, customInstructions?: string) => void,
) {
  msa.registerCommand("trigger-compact", {
    description: "Trigger compaction immediately",
    handler: (args, ctx) => {
      const instructions = args.trim() || undefined;
      triggerCompaction(ctx, instructions);
      return Promise.resolve();
    },
  });
}
