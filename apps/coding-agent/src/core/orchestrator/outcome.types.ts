import type orchestratorTypesTypes from "./types.types.ts";

declare namespace outcomeTypes {
  interface ProviderLimit {
    reason: orchestratorTypesTypes.ProviderWait["reason"];
    error: string;
    resetsAt: number | undefined;
    sessionFile: string | null;
  }

  interface Outcome {
    status: orchestratorTypesTypes.ThreadStatus;
    content: string;
    limit?: ProviderLimit;
  }
}

export type { outcomeTypes as default };
