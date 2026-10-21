import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type ToolExecutionComponentClass from "./tool-execution.ts";

declare namespace toolExecutionTypes {
  interface ToolExecutionOptions {
    showImages?: boolean;
    imageWidthCells?: number;
    outputPad?: number;
  }

  interface ToolCallSummary {
    toolName: string;
    args: any;
    done: boolean;
    isError: boolean;
    details: any;
  }

  type ToolExecutionComponent = (typeof ToolExecutionComponentClass)["prototype"];

  type ToolRenderers = extensionsTypesTypes.ToolRenderers;
}

export type { toolExecutionTypes as default };
