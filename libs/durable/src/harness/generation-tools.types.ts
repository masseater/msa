import type generationTypesModule from "./generation-types.types.ts";
import type liveTypes from "./live.types.ts";
import type toolTypes from "./tool.types.ts";

declare namespace generationToolsTypes {
  type ToolSlot = liveTypes.ToolSlot;

  type ToolTaskResult = toolTypes.ToolTaskResult;

  type GenerationCheckpoint = generationTypesModule.GenerationCheckpoint;

  type GenerationNext = generationTypesModule.GenerationNext;

  type GenerationRequest = generationTypesModule.GenerationRequest;

  type GenerationRuntime = generationTypesModule.GenerationRuntime;
}

export type { generationToolsTypes as default };
