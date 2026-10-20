import type orchestratorTypes from "../../core/orchestrator/orchestrator.types.ts";
import type tasksViewHelpersTypes from "./components/tasks-view-helpers.types.ts";
import type OrchestratorPaneClass from "./orchestrator-pane.ts";
import type PaneWidthClass from "./pane-width.ts";

declare namespace orchestratorPaneTypes {
  interface OrchestratorPaneOptions {
    orchestrator: () => orchestratorTypes.Orchestrator | undefined;
    state: tasksViewHelpersTypes.TasksViewState;
    columns: () => number;
    rows: () => number;
    requestRender: () => void;
  }

  type PaneWidth = (typeof PaneWidthClass)["prototype"];

  type OrchestratorPane = (typeof OrchestratorPaneClass)["prototype"];
}

export type { orchestratorPaneTypes as default };
