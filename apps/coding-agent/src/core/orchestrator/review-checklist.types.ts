declare namespace reviewChecklistTypes {
  interface Entry {
    item: number;
    status: "met" | "unmet";
    evidence: string;
  }

  interface Checklist {
    goalState: string;
    entries: readonly Entry[];
  }

  type Judgement =
    | { kind: "missing"; text: string }
    | { kind: "mismatch"; text: string }
    | { kind: "unmet"; text: string }
    | { kind: "met"; text: string };
}

export type { reviewChecklistTypes as default };
