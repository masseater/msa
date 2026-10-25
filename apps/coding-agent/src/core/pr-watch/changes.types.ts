declare namespace changesTypes {
  type PrChangeKind =
    | "merged"
    | "closed"
    | "conflict"
    | "base-moved"
    | "checks-failed"
    | "checks-cancelled"
    | "checks-passed"
    | "review"
    | "comment";

  interface PrChange {
    readonly kind: PrChangeKind;
    readonly label: string;
    readonly text: string;
    readonly terminal: boolean;
  }
}

export type { changesTypes as default };
