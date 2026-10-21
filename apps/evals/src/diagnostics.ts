import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import type agentSessionTypes from "./agent-session.types.ts";
import platform from "./platform.ts";
import type runTypesTypes from "./run-types.ts";
import transcript from "./transcript.ts";

const { sha256Hex } = platform;
const { toTranscriptEvents } = transcript;

const collectDiagnostics = ({
  session,
  model,
  systemPrompt,
}: {
  session: codingAgentTypes.AgentSession;
  model: agentSessionTypes.PreparedModel["model"];
  systemPrompt: string;
}): Effect.Effect<runTypesTypes.MsaRunDiagnostics> =>
  Effect.gen(function* () {
    const stats = session.context.stats.getSessionStats();
    const hasPricing = [model.cost, ...(model.cost.tiers ?? [])].some(
      ({ input, output, cacheRead, cacheWrite }) =>
        input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0,
    );
    const digest = yield* sha256Hex(systemPrompt);
    return {
      events: toTranscriptEvents(session.messages),
      metadata: { systemPromptSha256: digest },
      usage: {
        inputTokens: stats.tokens.input,
        metadata: {
          cacheReadTokens: stats.tokens.cacheRead,
          cacheWriteTokens: stats.tokens.cacheWrite,
          ...(hasPricing ? { estimatedCostUsd: stats.cost } : {}),
        },
        model: model.id,
        outputTokens: stats.tokens.output,
        provider: model.provider,
        toolCalls: stats.toolCalls,
        totalTokens: stats.tokens.total,
      },
    };
  });

const diagnostics = {
  collectDiagnostics,
};

export default diagnostics;
