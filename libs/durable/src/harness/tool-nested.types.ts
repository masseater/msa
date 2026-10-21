import type liveTypes from "./live.types.ts";
import type toolTypesModule from "./tool-types.types.ts";

declare namespace toolNestedTypes {
  type NestedOptions = {
    readonly key: string;
    readonly progress: boolean | undefined;
    readonly abandonOnRestart: boolean;
  };

  type NestedToolSlot = liveTypes.NestedToolSlot;

  type ToolRuntime = toolTypesModule.ToolRuntime;

  type ToolTaskInput = toolTypesModule.ToolTaskInput;

  type ToolTaskResult = toolTypesModule.ToolTaskResult;
}

export type { toolNestedTypes as default };
