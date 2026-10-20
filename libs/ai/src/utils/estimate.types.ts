declare namespace estimateTypes {
  interface ContextUsageEstimate {
    tokens: number;
    usageTokens: number;
    trailingTokens: number;
    lastUsageIndex: number | null;
  }
}

export type { estimateTypes as default };
