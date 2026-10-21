import type extensionsTypesTypes from "./extensions/types.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

declare namespace projectTrustTypes {
  type AppMode = "interactive" | "print" | "json" | "rpc";

  interface ResolveProjectTrustedOptions {
    cwd: string;
    trustStore: trustManagerTypes.ProjectTrustStore;
    trustOverride?: boolean | undefined;
    defaultProjectTrust?: settingsManagerTypes.DefaultProjectTrust | undefined;
    extensionsResult?: extensionsTypesTypes.LoadExtensionsResult | undefined;
    projectTrustContext: extensionsTypesTypes.ProjectTrustContext;
    onExtensionError?: ((message: string) => void) | undefined;
  }
}

export type { projectTrustTypes as default };
