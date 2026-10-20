import type memoryFormatTypes from "./memory-format.types.ts";
import type MemoryServiceClass from "./memory-service.ts";
import type memoryTypesTypes from "./memory-types.ts";

declare namespace memoryTypes {
  type MemoryService = (typeof MemoryServiceClass)["prototype"];

  type MemoryCommand = memoryFormatTypes.MemoryCommand;

  type MemorySaveOutcome = memoryTypesTypes.MemorySaveOutcome;

  type MemoryServiceOptions = memoryTypesTypes.MemoryServiceOptions;

  type MemorySaveRequest = memoryTypesTypes.MemorySaveRequest;

  type ResolvedMemorySettings = memoryTypesTypes.ResolvedMemorySettings;
}

export type { memoryTypes as default };
