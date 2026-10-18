
import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  msa.on("agent_start", (_event, ctx) => {
    const prompt = ctx.getSystemPrompt();
    ctx.ui.setStatus("system-prompt", `System: ${prompt.length} chars`);
  });

  msa.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("system-prompt", undefined);
  });
}
