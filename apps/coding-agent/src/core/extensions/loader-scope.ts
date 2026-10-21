import type eventBusTypes from "../event-bus.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace loaderScopeTypes {
  interface ApiScope {
    extension: extensionsTypesTypes.Extension;
    runtime: extensionsTypesTypes.ExtensionRuntime;
    cwd: string;
    eventBus: eventBusTypes.EventBus;
    assertActive: () => void;
    applyRuntimeChange: (change: () => void) => void;
    isLoading: () => boolean;
    pendingFlagValues: Map<string, boolean | string>;
    loadingUnsubscribers: Array<() => void>;
  }

  type HandlerFn = (...args: unknown[]) => Promise<unknown>;
}

export type { loaderScopeTypes as default };
