import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

export default function (msa: ExtensionAPI) {
  let turnCount = 0;

  msa.on("session_start", (event, ctx) => {
    ctx.ui.setTitle(event.reason === "new" ? "msa RPC Demo (new session)" : "msa RPC Demo");
    ctx.ui.setWidget("rpc-demo", ["--- RPC Extension UI Demo ---", "Loaded and ready."]);
    ctx.ui.setStatus("rpc-demo", `Turns: ${turnCount}`);
  });

  msa.on("turn_start", (_event, ctx) => {
    turnCount++;
    ctx.ui.setStatus("rpc-demo", `Turn ${turnCount} running...`);
  });

  msa.on("turn_end", (_event, ctx) => {
    ctx.ui.setStatus("rpc-demo", `Turn ${turnCount} done`);
  });

  msa.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const isDangerous = /\brm\s+(-rf?|--recursive)/iu.test(command) || /\bsudo\b/iu.test(command);

    if (isDangerous) {
      if (!ctx.hasUI) {
        return { block: true, reason: "Dangerous command blocked (no UI)" };
      }

      const choice = await ctx.ui.select(`Dangerous command: ${command}`, ["Allow", "Block"]);
      if (choice !== "Allow") {
        ctx.ui.notify("Command blocked by user", "warning");
        return { block: true, reason: "Blocked by user" };
      }
      ctx.ui.notify("Command allowed", "info");
    }

    return undefined;
  });

  msa.on("session_before_switch", async (event, ctx) => {
    if (event.reason !== "new") return;
    if (!ctx.hasUI) return;

    const confirmed = await ctx.ui.confirm("Clear session?", "All messages will be lost.");
    if (!confirmed) {
      ctx.ui.notify("Clear cancelled", "info");
      return { cancel: true };
    }
    return undefined;
  });

  msa.registerCommand("rpc-input", {
    description: "Prompt for text input (demonstrates ctx.ui.input in RPC)",
    handler: async (_args, ctx) => {
      const value = await ctx.ui.input("Enter a value", "type something...");
      if (value !== undefined && value.length > 0) {
        ctx.ui.notify(`You entered: ${value}`, "info");
      } else {
        ctx.ui.notify("Input cancelled", "info");
      }
    },
  });

  msa.registerCommand("rpc-editor", {
    description: "Open multi-line editor (demonstrates ctx.ui.editor in RPC)",
    handler: async (_args, ctx) => {
      const text = await ctx.ui.editor("Edit some text", "Line 1\nLine 2\nLine 3");
      if (text !== undefined && text.length > 0) {
        ctx.ui.notify(`Editor submitted (${text.split("\n").length} lines)`, "info");
      } else {
        ctx.ui.notify("Editor cancelled", "info");
      }
    },
  });

  msa.registerCommand("rpc-prefill", {
    description: "Prefill the input editor (demonstrates ctx.ui.setEditorText in RPC)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.ui.setEditorText("This text was set by the rpc-demo extension.");
          ctx.ui.notify("Editor prefilled", "info");
        }),
      ),
  });
}
