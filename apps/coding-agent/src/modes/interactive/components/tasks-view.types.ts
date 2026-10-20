import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";
import type TasksViewClass from "./tasks-view.ts";

declare namespace tasksViewTypes {
  interface TasksViewOptions {
    orchestrator: orchestratorTypes.Orchestrator;
    onClose: () => void;
    onPickModel: (taskId: string) => void;
    onError: (message: string) => void;
    requestRender: () => void;
    maxHeight: () => number;
    state?: tasksViewHelpersTypes.TasksViewState;
  }

  type TasksView = (typeof TasksViewClass)["prototype"];
}

export type { tasksViewTypes as default };
