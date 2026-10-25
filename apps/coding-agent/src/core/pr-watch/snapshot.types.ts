declare namespace snapshotTypes {
  interface PrWatchTarget {
    readonly number: number;
    readonly repository?: string | undefined;
  }

  interface PrCheckCounts {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly pending: number;
    readonly pendingNames: readonly string[];
  }

  interface PrSnapshot {
    readonly state: string;
    readonly mergeable: string;
    readonly mergeStateStatus: string;
    readonly reviewDecision: string;
    readonly updatedAt: string;
    readonly comments: number;
    readonly checks: PrCheckCounts;
    readonly baseRefName: string;
    readonly headRefOid: string;
    readonly behindBy: number | undefined;
  }
}

export type { snapshotTypes as default };
