import chalk from "chalk";

import awaitingModule from "./core/awaiting.ts";
import DefaultResourceLoader from "./core/default-resource-loader.ts";
import type extensionsTypesTypes from "./core/extensions/types.types.ts";
import platformModule from "./core/platform.ts";
import type projectTrustTypes from "./core/project-trust.types.ts";
import SettingsManager from "./core/settings-manager.ts";
import trustManager from "./core/trust-manager.ts";

const { writeError } = platformModule;
const { hasTrustRequiringProjectResources } = trustManager;
const { awaited } = awaitingModule;

function getCommandAppMode(): projectTrustTypes.AppMode {
  return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}

function reportProjectTrustWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    writeError(chalk.yellow(`Warning: ${warning}`));
  }
}

function* createCommandSettingsManagerPart1(
  options: {
    cwd: string;
    agentDir: string;
    projectTrustOverride?: boolean | undefined;
    useSavedProjectTrustOnly?: boolean | undefined;
    extensionFactories?: extensionsTypesTypes.InlineExtension[] | undefined;
  },
  settingsManager: SettingsManager,
  projectTrustWarnings: string[],
) {
  const extensionsResult =
    options.projectTrustOverride === undefined && hasTrustRequiringProjectResources(options.cwd)
      ? yield* awaited(
          new DefaultResourceLoader({
            agentDir: options.agentDir,
            cwd: options.cwd,
            extensionFactories: options.extensionFactories,
            settingsManager,
          }).extensions.loading.loadProjectTrustExtensions(),
        )
      : undefined;
  for (const error of extensionsResult?.errors ?? []) {
    projectTrustWarnings.push(`Failed to load extension "${error.path}": ${error.error}`);
  }
  return extensionsResult;
}

const packageManagerCliPart8 = {
  createCommandSettingsManagerPart1,
  getCommandAppMode,
  reportProjectTrustWarnings,
};

export default packageManagerCliPart8;
