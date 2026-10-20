import * as Effect from "effect/Effect";

import projectTrustModule from "./cli/project-trust.ts";
import awaitingModule from "./core/awaiting.ts";
import type extensionsTypesTypes from "./core/extensions/types.types.ts";
import ProjectTrustStore from "./core/project-trust-store.ts";
import projectTrust from "./core/project-trust.ts";
import SettingsManager from "./core/settings-manager.ts";
import type packageManagerCliInternalTypes from "./package-manager-cli-internal.types.ts";
import packageManagerCliPart8 from "./package-manager-cli-part8.ts";

const { awaited, awaiting } = awaitingModule;
const { resolveProjectTrusted } = projectTrust;
const { createProjectTrustContext } = projectTrustModule;
const { createCommandSettingsManagerPart1, getCommandAppMode } = packageManagerCliPart8;

function createCommandSettingsManager(options: {
  cwd: string;
  agentDir: string;
  projectTrustOverride?: boolean | undefined;
  useSavedProjectTrustOnly?: boolean | undefined;
  extensionFactories?: extensionsTypesTypes.InlineExtension[] | undefined;
}): Promise<packageManagerCliInternalTypes.CommandSettingsResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
        projectTrusted: false,
      });
      const projectTrustWarnings: string[] = [];
      const trustStore = new ProjectTrustStore(options.agentDir);
      if (options.useSavedProjectTrustOnly === true) {
        const savedProjectTrusted = trustStore.get(options.cwd) === true;
        settingsManager.setProjectTrusted(options.projectTrustOverride ?? savedProjectTrusted);
        return { projectTrustWarnings, settingsManager };
      }

      const appMode = getCommandAppMode();
      const extensionsResult = yield* createCommandSettingsManagerPart1(
        options,
        settingsManager,
        projectTrustWarnings,
      );

      const projectTrusted = yield* awaited(
        resolveProjectTrusted({
          cwd: options.cwd,
          defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
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
      settingsManager.setProjectTrusted(projectTrusted);
      return { projectTrustWarnings, settingsManager };
    }),
  );
}

const packageManagerCliPart9 = {
  createCommandSettingsManager,
};

export default packageManagerCliPart9;
