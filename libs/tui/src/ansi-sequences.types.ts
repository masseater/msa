declare namespace ansiSequencesTypes {
  type EscapeKind = "csi" | "osc" | "dcs" | "apc";

  interface EscapeSequence {
    kind: EscapeKind;
    raw: string;
    body: string;
    final: string;
    terminator: string;
  }

  interface EscapeMatch {
    final: string;
    groups: RegExpExecArray;
  }
}

export type { ansiSequencesTypes as default };
