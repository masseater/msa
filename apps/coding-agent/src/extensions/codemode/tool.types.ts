import type { Static } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type modelRegistryTypes from "../../core/model-registry.types.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type tool from "./tool.ts";

declare namespace toolTypes {
  interface CodemodeStoreEntryData {
    set: Record<string, unknown>;
    delete: string[];
  }

  type CodemodeModelRuntime = Pick<
    modelRegistryTypes.ModelRegistry,
    "getModelsOfType" | "getAvailableOfType" | "getModelOfType" | "classify" | "generateImages"
  >;

  interface CodemodeToolOptions {
    getToolNamespace?: (toolName: string) => extensionsTypesTypes.ToolNamespace | undefined;

    getToolGuidelines?: () => ReadonlyMap<string, readonly string[]>;

    models?: boolean;

    appendEntry?: (customType: string, data: CodemodeStoreEntryData) => void;

    getMode?: () => settingsManagerTypes.CodemodeMode;

    getInlineBudget?: () => number | undefined;
  }

  type CodemodeToolInput = Static<typeof tool.codemodeSchema>;

  type CodemodeNestedCallStatus = "running" | "ok" | "error" | "cancelled";

  interface CodemodeNestedCall {
    id: string;
    name: string;

    args: string;
    status: CodemodeNestedCallStatus;
    durationMs?: number;

    error?: string;

    cost?: number;
  }

  interface CodemodeToolDetails {
    calls: CodemodeNestedCall[];

    fullOutputPath?: string;
  }

  interface CodemodeDescriptionOptions {
    models?: boolean;

    namespaces?: ReadonlyMap<string, extensionsTypesTypes.ToolNamespace>;

    deferred?: ReadonlySet<string>;

    guidelines?: ReadonlyMap<string, readonly string[]>;

    inlineBudget?: number;
  }
}

export type { toolTypes as default };
