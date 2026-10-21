import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerEventsTypes {
  interface ShutdownEmitter {
    hasHandlers(eventType: string): boolean;
    emit(event: extensionsTypesTypes.SessionShutdownEvent): Promise<unknown>;
  }
}

export type { runnerEventsTypes as default };
