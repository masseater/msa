import type generationTypesModule from "./generation-types.types.ts";
import type inboxTypes from "./inbox.types.ts";

declare namespace generationFinishTypes {
  type Boundary = inboxTypes.Boundary;

  type GenerationNext = generationTypesModule.GenerationNext;

  type GenerationRuntime = generationTypesModule.GenerationRuntime;

  type ToolTaskId = generationTypesModule.ToolTaskId;
}

export type { generationFinishTypes as default };
