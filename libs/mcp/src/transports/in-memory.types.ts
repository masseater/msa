import type inMemory from "./in-memory.ts";

declare namespace inMemoryTypes {
  type InMemoryTransport = (typeof inMemory.InMemoryTransport)["prototype"];
}

export type { inMemoryTypes as default };
