import type packageManagerTypes from "../../../core/package-manager.types.ts";
import type ConfigSelectorComponentClass from "./config-selector.ts";

declare namespace configSelectorTypes {
  type ConfigWriteScope = "global" | "project";

  type ScopedResolvedPaths = Record<ConfigWriteScope, packageManagerTypes.ResolvedPaths>;

  type ConfigSelectorComponent = (typeof ConfigSelectorComponentClass)["prototype"];
}

export type { configSelectorTypes as default };
