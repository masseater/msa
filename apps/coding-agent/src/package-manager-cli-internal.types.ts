import type extensionsTypesTypes from "./core/extensions/types.types.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

declare namespace packageManagerCliInternalTypes {
  type UpdateTarget =
    | { type: "all" }
    | { type: "self" }
    | { type: "extensions"; source?: string }
    | { type: "models" };

  interface PackageCommandOptions {
    command: packageManagerCliTypes.PackageCommand;
    source?: string | undefined;
    updateTarget?: UpdateTarget | undefined;
    showExtensionsSkippedNote: boolean;
    local: boolean;
    force: boolean;
    projectTrustOverride?: boolean | undefined;
    help: boolean;
    invalidOption?: string | undefined;
    invalidArgument?: string | undefined;
    missingOptionValue?: string | undefined;
    conflictingOptions?: string | undefined;
  }

  interface SelfUpdatePlan {
    installSpec: string;
    version: string;
    shouldRun: boolean;
  }

  interface CommandSettingsOptions {
    cwd: string;
    agentDir: string;
    projectTrustOverride?: boolean | undefined;
    useSavedProjectTrustOnly?: boolean | undefined;
    extensionFactories?: extensionsTypesTypes.InlineExtension[] | undefined;
  }

  interface CommandSettingsResult {
    settingsManager: settingsManagerTypes.SettingsManager;
    projectTrustWarnings: string[];
  }
}

export type { packageManagerCliInternalTypes as default };
