import * as Effect from "effect/Effect";

import projectTrustModule from "../cli/project-trust.ts";
import awaitingModule from "../core/awaiting.ts";
import DefaultResourceLoader from "../core/default-resource-loader.ts";
import ProjectTrustStore from "../core/project-trust-store.ts";
import projectTrust from "../core/project-trust.ts";
import type projectTrustTypes from "../core/project-trust.types.ts";
import SettingsManager from "../core/settings-manager.ts";
import trustManager from "../core/trust-manager.ts";
import type packageManagerCliInternalTypes from "../package-manager-cli-internal.types.ts";

const { createProjectTrustContext } = projectTrustModule;
const { resolveProjectTrusted } = projectTrust;
const { awaiting, awaited } = awaitingModule;

const { hasTrustRequiringProjectResources } = trustManager;

function getCommandAppMode(): projectTrustTypes.AppMode {
  return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}

function* loadProjectTrustExtensions(
  options: packageManagerCliInternalTypes.CommandSettingsOptions,
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

function createCommandSettingsManager(
  options: packageManagerCliInternalTypes.CommandSettingsOptions,
): Promise<packageManagerCliInternalTypes.CommandSettingsResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const settingsManager = yield* awaited(
        SettingsManager.create(options.cwd, options.agentDir, {
          projectTrusted: false,
        }),
      );
      const projectTrustWarnings: string[] = [];
      const trustStore = new ProjectTrustStore(options.agentDir);
      if (options.useSavedProjectTrustOnly === true) {
        const savedProjectTrusted = trustStore.get(options.cwd) === true;
        yield* awaited(
          settingsManager.persistence.setProjectTrusted(
            options.projectTrustOverride ?? savedProjectTrusted,
          ),
        );
        return { projectTrustWarnings, settingsManager };
      }

      const appMode = getCommandAppMode();
      const extensionsResult = yield* loadProjectTrustExtensions(
        options,
        settingsManager,
        projectTrustWarnings,
      );

      const projectTrusted = yield* awaited(
        resolveProjectTrusted({
          cwd: options.cwd,
          defaultProjectTrust: settingsManager.session.getDefaultProjectTrust(),
          extensionsResult,
          onExtensionError: (message) => projectTrustWarnings.push(message),
          projectTrustContext: createProjectTrustContext({
            cwd: options.cwd,
            hasUI: appMode === "interactive",
            mode: appMode,
            settingsManager,
          }),
          trustOverride: options.projectTrustOverride,
          trustStore,
        }),
      );
      yield* awaited(settingsManager.persistence.setProjectTrusted(projectTrusted));
      return { projectTrustWarnings, settingsManager };
    }),
  );
}

const commandSettings = { createCommandSettingsManager };

export default commandSettings;
