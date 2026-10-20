import type codingAgentTypes from "@msa/coding-agent/index.types";

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("agent_start", (_event, ctx) => {
    const prompt = ctx.getSystemPrompt();
    ctx.ui.setStatus("system-prompt", `System: ${prompt.length} chars`);
  });

  msa.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("system-prompt", undefined);
  });
}
