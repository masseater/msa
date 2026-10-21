import type extensionsTypesTypes from "./core/extensions/types.types.ts";

declare namespace mainTypes {
  interface MainOptions {
    extensionFactories?: extensionsTypesTypes.InlineExtension[];
  }
}

export type { mainTypes as default };
