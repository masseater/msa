declare namespace replanSupportTypes {
  interface StopOutcome {
    aborted: string | null;
    memos: Map<string, string>;
  }
}

export type { replanSupportTypes as default };
