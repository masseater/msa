import type extensionsTypesTypes from "./core/extensions/types.types.ts";

declare namespace packageManagerCliTypes {
  type PackageCommand = "install" | "remove" | "update" | "list";

  interface PackageCommandRuntimeOptions {
    extensionFactories?: extensionsTypesTypes.InlineExtension[];
  }
}

export type { packageManagerCliTypes as default };
