declare namespace usageTotalsTypes {
  interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  }

  interface UsageCostBreakdownEntry {
    key: string;
    cost: number;
    tokens: number;
  }
}

export type { usageTotalsTypes as default };
