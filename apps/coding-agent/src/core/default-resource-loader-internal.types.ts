import type extensionsTypesTypes from "./extensions/types.types.ts";

declare namespace defaultResourceLoaderInternalTypes {
  type BuiltinExtension = Exclude<
    extensionsTypesTypes.InlineExtension,
    extensionsTypesTypes.ExtensionFactory
  >;
}

export type { defaultResourceLoaderInternalTypes as default };
