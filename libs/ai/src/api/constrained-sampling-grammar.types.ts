declare namespace constrainedSamplingGrammarTypes {
  interface GrammarConstrainedSampling {
    format: "lark" | "regex";
    definition: string;
    inputProperty: string;
  }

  interface GrammarToolInputJsonBuffer {
    input: string;
    started: boolean;
    closed: boolean;
  }
}

export type { constrainedSamplingGrammarTypes as default };
