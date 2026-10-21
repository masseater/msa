import type memoryTypes from "../memory.types.ts";
import type filesTypes from "./files.types.ts";

declare namespace recoverReplayTypes {
  type JsonlFiles = filesTypes.JsonlFiles;

  type MemoryStorage = memoryTypes.MemoryStorage;
}

export type { recoverReplayTypes as default };
