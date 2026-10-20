import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";
import type ThreadPaneClass from "./thread-pane.ts";

declare namespace threadPaneTypes {
  interface ThreadPaneOptions {
    orchestrator: () => orchestratorTypes.Orchestrator | undefined;
    state: tasksViewHelpersTypes.TasksViewState;
    height: () => number;
  }

  type ThreadPane = (typeof ThreadPaneClass)["prototype"];
}

export type { threadPaneTypes as default };
