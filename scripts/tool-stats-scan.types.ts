declare namespace toolStatsScanTypes {
  interface ToolStats {
    calls: number;
    results: number;
    estimatedTokens: number;
    samples: Array<number>;
    errors: number;
  }

  interface BashCommandStats {
    calls: number;
    estimatedTokens: number;
    samples: Array<number>;
  }
}

export type { toolStatsScanTypes as default };
