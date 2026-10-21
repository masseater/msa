declare namespace latexLayoutTypes {
  interface FractionNode {
    type: "fraction";
    numerator: string;
    denominator: string;
  }

  interface OperatorNode {
    type: "operator";
    operator: string;
    lower?: string | undefined;
    upper?: string | undefined;
  }

  interface ScriptNode {
    type: "script";
    lower?: string | undefined;
    upper?: string | undefined;
  }

  interface MatrixNode {
    type: "matrix";
    lines: string[];
    baseline: number;
  }

  type LayoutNode = FractionNode | OperatorNode | ScriptNode | MatrixNode;
}

export type { latexLayoutTypes as default };
