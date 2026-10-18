import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

export default function (msa: ExtensionAPI) {
  msa.registerCommand("ask", {
    description: "Send a user message to the agent",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (args.trim().length === 0) {
            ctx.ui.notify("Usage: /ask <message>", "warning");
            return;
          }

          if (!ctx.isIdle()) {
            ctx.ui.notify("Agent is busy. Use /steer or /followup instead.", "warning");
            return;
          }

          msa.sendUserMessage(args);
        }),
      ),
  });

  msa.registerCommand("steer", {
    description: "Send a steering message (interrupts current processing)",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (args.trim().length === 0) {
            ctx.ui.notify("Usage: /steer <message>", "warning");
            return;
          }

          if (ctx.isIdle()) {
            msa.sendUserMessage(args);
          } else {
            msa.sendUserMessage(args, { deliverAs: "steer" });
          }
        }),
      ),
  });

  msa.registerCommand("followup", {
    description: "Queue a follow-up message (waits for current processing)",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (args.trim().length === 0) {
            ctx.ui.notify("Usage: /followup <message>", "warning");
            return;
          }

          if (ctx.isIdle()) {
            msa.sendUserMessage(args);
          } else {
            msa.sendUserMessage(args, { deliverAs: "followUp" });
            ctx.ui.notify("Follow-up queued", "info");
          }
        }),
      ),
  });

  msa.registerCommand("askwith", {
    description: "Send a user message with structured content",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (args.trim().length === 0) {
            ctx.ui.notify("Usage: /askwith <message>", "warning");
            return;
          }

          if (!ctx.isIdle()) {
            ctx.ui.notify("Agent is busy", "warning");
            return;
          }

          msa.sendUserMessage([
            { type: "text", text: `User request: ${args}` },
            { type: "text", text: "Please respond concisely." },
          ]);
        }),
      ),
  });
}
