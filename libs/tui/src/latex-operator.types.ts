declare namespace latexOperatorTypes {
  interface OperatorStyle {
    inlineLowerStyle: "bracket" | "script";
    displayLimits: boolean;
    spaced?: boolean;
  }
}

export type { latexOperatorTypes as default };
