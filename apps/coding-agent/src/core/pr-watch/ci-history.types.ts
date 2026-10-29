declare namespace ciHistoryTypes {
  interface CiRun {
    readonly workflow: string;
    readonly durationMs: number;
    readonly succeeded: boolean;
  }

  interface WorkflowTimeout {
    readonly workflow: string;
    readonly timeoutMs: number;
  }

  type CiStallLimit =
    | {
        readonly basis: "history";
        readonly limitMs: number;
        readonly typicalMs: number;
        readonly runs: number;
      }
    | {
        readonly basis: "timeout";
        readonly limitMs: number;
        readonly timeoutMs: number;
      };

  interface CiHistory {
    readonly headRefOid: string;
    readonly runs: readonly CiRun[];
    readonly timeouts: readonly WorkflowTimeout[];
  }
}

export type { ciHistoryTypes as default };
