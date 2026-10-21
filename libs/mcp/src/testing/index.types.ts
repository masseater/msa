import type inMemoryTypes from "../transports/in-memory.types.ts";

declare namespace testingTypes {
  type InMemoryTransport = inMemoryTypes.InMemoryTransport;
}

export type { testingTypes as default };
