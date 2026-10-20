import type loadedResourcesTypes from "./loaded-resources.types.ts";

declare namespace loadedResourcesInternalTypes {
  type ScopeName = "user" | "project" | "path";

  type ScopeGroup = {
    scope: ScopeName;
    paths: loadedResourcesTypes.ResourceItem[];
    packages: Map<string, loadedResourcesTypes.ResourceItem[]>;
  };
}

export type { loadedResourcesInternalTypes as default };
