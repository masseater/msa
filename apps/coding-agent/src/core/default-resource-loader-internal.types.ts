import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";

declare namespace defaultResourceLoaderInternalTypes {
  type BuiltinExtension = Exclude<
    extensionsTypesTypes.InlineExtension,
    extensionsTypesTypes.ExtensionFactory
  >;

  type ResourceSources = { cli: string[]; configured: string[] };

  type ResourcePlan = {
    extensions: ResourceSources;
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>;
    preTrustExtensions: extensionsTypesTypes.LoadExtensionsResult | undefined;
    prompts: ResourceSources;
    skills: ResourceSources;
    themes: ResourceSources;
  };
}

export type { defaultResourceLoaderInternalTypes as default };
