import type HandlerInvokerClass from "./runner-invoker.ts";
import type typesRuntimeTypes from "./types-runtime.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerInvokerTypes {
  interface EmitHost {
    readonly extensions: extensionsTypesTypes.Extension[];
    createContext(): extensionsTypesTypes.ExtensionContext;
    emitError(error: extensionsTypesTypes.ExtensionError): void;
    assertActive(): void;
  }

  interface HandlerRun {
    ext: extensionsTypesTypes.Extension;
    eventType: string;
    handler: typesRuntimeTypes.HandlerFn;
    event: unknown;
    ctx: extensionsTypesTypes.ExtensionContext;
  }

  type HandlerOutcome = { ok: true; value: unknown } | { ok: false };

  interface HandlerSlot {
    ext: extensionsTypesTypes.Extension;
    handler: typesRuntimeTypes.HandlerFn;
  }

  type HandlerInvoker = (typeof HandlerInvokerClass)["prototype"];
}

export type { runnerInvokerTypes as default };
