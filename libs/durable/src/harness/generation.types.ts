import type generationTypesModule from "./generation-types.types.ts";

declare namespace generationTypes {
  type GenerationCheckpoint = generationTypesModule.GenerationCheckpoint;

  type GenerationInput = generationTypesModule.GenerationInput;

  type GenerationResult = generationTypesModule.GenerationResult;
}

export type { generationTypes as default };
