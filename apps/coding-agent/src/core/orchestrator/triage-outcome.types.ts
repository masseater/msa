import type triageTypes from "./triage.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

declare namespace triageOutcomeTypes {
  type ReportStatus = workerTypes.ReportStatus;

  interface SendBack {
    task: orchestratorTypesTypes.Task;
    prompt: string;
  }

  interface Resume {
    task: orchestratorTypesTypes.Task;
    decision: string;
    ask: triageTypes.Ask | undefined;
  }

  interface Applied {
    review: orchestratorTypesTypes.Task[];
    sendBack: SendBack[];
    triage: triageTypes.Ask[];
    resumes: Resume[];
    lines: string[];
    status: ReportStatus;
  }
}

export type { triageOutcomeTypes as default };
