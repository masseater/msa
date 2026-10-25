declare namespace triageTypes {
  type HumanReason = "billing" | "personal-data" | "key-revocation" | "undecided-spec";

  type Conclusion =
    | {
        conclusion: "decided";
        decision: string;
        grounds: string;
        goalItems: readonly { item: number; how: string }[];
      }
    | {
        conclusion: "needs-human";
        decision: string;
        grounds: string;
        humanReason: HumanReason;
        noPrecedent: string;
      }
    | { conclusion: "compromise"; decision: string; grounds: string; compromises: string[] }
    | { conclusion: "repeat"; decision: string; grounds: string; repeats: number };

  interface Decision {
    requestKey: string;
    contentsId: string | null;
    request: string;
    decision: string;
  }

  interface Repeated {
    number: number;
    decision: Decision;
  }

  interface Ask {
    taskId: string;
    threadId: string;
    request: string;
    key: string;
  }

  interface PendingAsk {
    triageThreadId: string;
    ask: Ask;
    createdAt: number;
  }

  interface ReadOnlyCheckout {
    threadId: string;
    cwd: string;
    repository: string;
  }
}

export type { triageTypes as default };
