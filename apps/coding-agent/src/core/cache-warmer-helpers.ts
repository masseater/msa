import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import type sessionManagerTypes from "./session-manager.types.ts";

const { calculateCost } = ai;

const MAX_WARMING_AGE_MS = 60 * 60_000;

const MAX_IDLE_WARMING_AGE_MS = 30 * 60_000;

const IDLE_CONTINUATION_PROBABILITY = 0.15;

function lastPromptTokens(entries: sessionManagerTypes.SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type === "message" && entry.message.role === "assistant") {
      const usage = entry.message.usage;
      return usage.input + usage.cacheRead + usage.cacheWrite;
    }
  }
  return 0;
}

function price(
  model: aiTypes.Model<aiTypes.Api>,
  tokens: Partial<Pick<aiTypes.Usage, "input" | "output" | "cacheRead" | "cacheWrite">>,
): number {
  const usage: aiTypes.Usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
    ...tokens,
  };
  return calculateCost(model, usage).total;
}

const cacheWarmerHelpers = {
  IDLE_CONTINUATION_PROBABILITY,
  MAX_IDLE_WARMING_AGE_MS,
  MAX_WARMING_AGE_MS,
  lastPromptTokens,
  price,
};

export default cacheWarmerHelpers;
