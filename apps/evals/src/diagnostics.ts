import type { AgentSession } from "@msa/coding-agent";
import { Effect } from "effect";

import type { PreparedModel } from "./agent-session.ts";
import { sha256Hex } from "./platform.ts";
import type { MsaRunDiagnostics } from "./run-types.ts";
import { toTranscriptEvents } from "./transcript.ts";

export const collectDiagnostics = ({
  session,
  model,
  systemPrompt,
}: {
  session: AgentSession;
  model: PreparedModel["model"];
  systemPrompt: string;
}): Effect.Effect<MsaRunDiagnostics> =>
  Effect.gen(function* () {
    const stats = session.getSessionStats();
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
