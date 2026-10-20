import type typesModule from "./types.types.ts";

declare namespace eventsChangesTypes {
  type TaskChange = Extract<typesModule.CommitChange, { type: "task" }>;

  type TaskValue = TaskChange["value"];

  type Changes = {
    readonly entries: typesModule.EntryRecord[];
    readonly tasks: Map<typesModule.TaskId, TaskValue>;
    readonly submissions: typesModule.SubmissionRecord[];
    readonly nestedResults: Map<typesModule.TaskId, typesModule.NestedToolExecutionResult>;
  };
}

export type { eventsChangesTypes as default };
