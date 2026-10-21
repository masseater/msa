import type toolTypesModule from "./tool-types.types.ts";

declare namespace toolTypes {
  type NestedCallState = toolTypesModule.NestedCallState;

  type ToolTaskCheckpoint = toolTypesModule.ToolTaskCheckpoint;

  type ToolTaskInput = toolTypesModule.ToolTaskInput;

  type ToolTaskResult = toolTypesModule.ToolTaskResult;
}

export type { toolTypes as default };
