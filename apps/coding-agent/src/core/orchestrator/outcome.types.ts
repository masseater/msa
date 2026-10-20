import type orchestratorTypesTypes from "./types.types.ts";

declare namespace outcomeTypes {
  interface Outcome {
    status: orchestratorTypesTypes.ThreadStatus;
    content: string;
  }
}

export type { outcomeTypes as default };
