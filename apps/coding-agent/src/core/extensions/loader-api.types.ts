import type eventBusTypes from "../event-bus.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace loaderApiTypes {
  interface ExtensionApiInput {
    extension: extensionsTypesTypes.Extension;
    runtime: extensionsTypesTypes.ExtensionRuntime;
    cwd: string;
    eventBus: eventBusTypes.EventBus;
  }
}

export type { loaderApiTypes as default };
