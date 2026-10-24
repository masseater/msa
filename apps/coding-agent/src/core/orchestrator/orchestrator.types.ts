import type handoffTypes from "./handoff.types.ts";
import type OrchestratorClass from "./orchestrator.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

declare namespace orchestratorTypes {
  type Orchestrator = (typeof OrchestratorClass)["prototype"];

  type HandoffInput = handoffTypes.HandoffInput;

  type HandoffResult = handoffTypes.HandoffResult;

  type CreateTaskInput = orchestratorTypesTypes.CreateTaskInput;

  type NoteDelivery = orchestratorTypesTypes.NoteDelivery;

  type ReplanInput = orchestratorTypesTypes.ReplanInput;

  type ReplanResult = orchestratorTypesTypes.ReplanResult;

  type SendNoteInput = orchestratorTypesTypes.SendNoteInput;

  type SetTaskDependsInput = orchestratorTypesTypes.SetTaskDependsInput;

  type SetTaskStateInput = orchestratorTypesTypes.SetTaskStateInput;

  type OrchestratorSnapshot = orchestratorTypesTypes.OrchestratorSnapshot;

  type ReportHit = orchestratorTypesTypes.ReportHit;

  type TaskView = orchestratorTypesTypes.TaskView;

  type CommandResult = workerTypes.CommandResult;

  type CreateWorkerOptions = workerTypes.CreateWorkerOptions;

  type OrchestratorDefaults = workerTypes.OrchestratorDefaults;

  type OrchestratorOptions = workerTypes.OrchestratorOptions;

  type OrchestratorReport = workerTypes.OrchestratorReport;

  type ReportStatus = workerTypes.ReportStatus;

  type WorkerSession = workerTypes.WorkerSession;
}

export type { orchestratorTypes as default };
