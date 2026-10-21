declare namespace compactionTokensTypes {
  interface ContextUsageEstimate {
    tokens: number;
    usageTokens: number;
    trailingTokens: number;
    lastUsageIndex: number | null;
  }
}

export type { compactionTokensTypes as default };
