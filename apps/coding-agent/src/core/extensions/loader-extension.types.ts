import type extensionsTypesTypes from "./types.types.ts";

declare namespace loaderExtensionTypes {
  interface LoadOutcome {
    extension: extensionsTypesTypes.Extension | null;
    error: string | null;
  }
}

export type { loaderExtensionTypes as default };
