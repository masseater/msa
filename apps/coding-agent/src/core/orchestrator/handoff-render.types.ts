import type orchestratorTypesTypes from "./types.types.ts";

declare namespace handoffRenderTypes {
  interface HandoffSections {
    premise: string;
    goals: string;
    donts: string;
  }

  interface HandoffItem {
    number: number;
    title: string;
    detail: string;
  }

  interface HandoffEnvironment {
    version: string;
    cwd: string;
    repository: string | undefined;
    branch: string | undefined;
    pulls: readonly HandoffItem[] | undefined;
    issues: readonly HandoffItem[] | undefined;
  }

  interface HandoffData {
    createdAt: number;
    environment: HandoffEnvironment;
    sections: HandoffSections;
    snapshot: orchestratorTypesTypes.OrchestratorSnapshot;
    notes: readonly orchestratorTypesTypes.Note[];
  }
}

export type { handoffRenderTypes as default };
