declare namespace ciHistoryTypes {
  interface CiRun {
    readonly workflow: string;
    readonly durationMs: number;
    readonly succeeded: boolean;
  }

  interface CiStallLimit {
    readonly limitMs: number;
    readonly typicalMs: number;
    readonly runs: number;
  }

  interface CiHistory {
    readonly headRefOid: string;
    readonly runs: readonly CiRun[] | undefined;
  }
}

export type { ciHistoryTypes as default };
