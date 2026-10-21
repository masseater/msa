import type linkMemory from "./link-memory.ts";

declare namespace linkMemoryTypes {
  type MemoryLink = (typeof linkMemory.MemoryLink)["prototype"];
}

export type { linkMemoryTypes as default };
