import type orchestratorTypesTypes from "../../../core/orchestrator/types.types.ts";

declare namespace tasksListTypes {
  interface TaskRowOptions {
    selected: boolean;
    width: number;
    meta: (task: orchestratorTypesTypes.TaskSnapshot) => string;
  }
}

export type { tasksListTypes as default };
