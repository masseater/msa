import type modelRegistryTypes from "../model-registry.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type runnerBindingsTypes from "./runner-bindings.types.ts";
import type ContextFactoryClass from "./runner-context.ts";
import type extensionsTypesTypes from "./types.types.ts";

declare namespace runnerContextTypes {
  interface ContextHost {
    assertActive: () => void;
    ui: () => extensionsTypesTypes.ExtensionUIContext;
    mode: () => extensionsTypesTypes.ExtensionMode;
    hasUI: () => boolean;
    cwd: string;
    sessionManager: sessionManagerTypes.SessionManager;
    modelRegistry: modelRegistryTypes.ModelRegistry;
    runtime: extensionsTypesTypes.ExtensionRuntime;
    bindings: runnerBindingsTypes.RunnerBindings;
  }

  type ContextFactory = (typeof ContextFactoryClass)["prototype"];
}

export type { runnerContextTypes as default };
