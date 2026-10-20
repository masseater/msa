import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Clock, Effect } from "effect";

function isAssistantMessage(message: unknown): message is aiTypes.AssistantMessage {
  if (typeof message !== "object" || message === null) return false;
  const role = (message as { role?: unknown }).role;
  return role === "assistant";
}

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let agentStartMs: number | null = null;

  msa.on("agent_start", () => {
    agentStartMs = Effect.runSync(Clock.currentTimeMillis);
  });

  msa.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (agentStartMs === null) return;

    const elapsedMs = Effect.runSync(Clock.currentTimeMillis) - agentStartMs;
    agentStartMs = null;
    if (elapsedMs <= 0) return;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let totalTokens = 0;

    for (const message of event.messages) {
      if (!isAssistantMessage(message)) continue;
      input += message.usage.input || 0;
      output += message.usage.output || 0;
      cacheRead += message.usage.cacheRead || 0;
      cacheWrite += message.usage.cacheWrite || 0;
      totalTokens += message.usage.totalTokens || 0;
    }

    if (output <= 0) return;

    const elapsedSeconds = elapsedMs / 1000;
    const tokensPerSecond = output / elapsedSeconds;
    const message = `TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${output.toLocaleString()}, in ${input.toLocaleString()}, cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()}, total ${totalTokens.toLocaleString()}, ${elapsedSeconds.toFixed(1)}s`;
    ctx.ui.notify(message, "info");
  });
}
