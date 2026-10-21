import type plan from "./plan.ts";

declare namespace planTypes {
  type DocumentationVariant = (typeof plan.DOCUMENTATION_VARIANTS)[number];

  type DiscoveredEvalCase = {
    file: string;
    fullName: string;
    evalSet: string;
    caseId: string;
  };

  type EvalTask = DiscoveredEvalCase & {
    variant: DocumentationVariant;
    model: string;
    runNumber: number;
  };
}

export type { planTypes as default };
