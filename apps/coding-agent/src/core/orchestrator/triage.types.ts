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
    | { conclusion: "compromise"; decision: string; grounds: string; compromises: string[] };

  interface Decision {
    requestKey: string;
    contentsId: string | null;
  }

  interface Ask {
    taskId: string;
    threadId: string;
    request: string;
    key: string;
  }
}

export type { triageTypes as default };
