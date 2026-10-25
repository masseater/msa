import type orchestratorTypesTypes from "./types.types.ts";

declare namespace threadPlanTypes {
  interface ThreadPlan {
    threadId: string;
    prompt: string;
    model: string;
    thinkingLevel: orchestratorTypesTypes.Task["thinkingLevel"];
    notes: readonly orchestratorTypesTypes.Note[];
    sessionFile?: string;
  }
}

export type { threadPlanTypes as default };
