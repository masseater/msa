import type orchestratorTypesTypes from "./types.types.ts";

declare namespace snapshotTypes {
  type CreateTaskInput = orchestratorTypesTypes.CreateTaskInput;

  type NoteDelivery = orchestratorTypesTypes.NoteDelivery;

  type OrchestratorSnapshot = orchestratorTypesTypes.OrchestratorSnapshot;

  type ReplanInput = orchestratorTypesTypes.ReplanInput;

  type ReplanResult = orchestratorTypesTypes.ReplanResult;

  type ReplanView = orchestratorTypesTypes.ReplanView;

  type ReportHit = orchestratorTypesTypes.ReportHit;

  type SendNoteInput = orchestratorTypesTypes.SendNoteInput;

  type SetTaskDependsInput = orchestratorTypesTypes.SetTaskDependsInput;

  type SetTaskStateInput = orchestratorTypesTypes.SetTaskStateInput;

  type TaskSnapshot = orchestratorTypesTypes.TaskSnapshot;

  type TaskView = orchestratorTypesTypes.TaskView;
}

export type { snapshotTypes as default };
