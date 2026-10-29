declare namespace reviewChecklistTypes {
  interface Entry {
    item: number;
    status: "met" | "unmet";
    evidence: string;
  }

  interface Checklist {
    goalState: string;
    entries: readonly Entry[];
    findings: readonly string[];
  }

  type Judgement =
    | { kind: "missing"; text: string }
    | { kind: "mismatch"; text: string }
    | { kind: "unmet"; text: string }
    | { kind: "met"; text: string; settled: boolean };
}

export type { reviewChecklistTypes as default };
