import configSelector from "../cli/config-selector.ts";
import awaitingModule from "../core/awaiting.ts";
import DefaultPackageManager from "../core/default-package-manager.ts";
import resourceLoader from "../core/resource-loader.ts";
import SettingsManager from "../core/settings-manager.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";
import trustedSettings from "./trusted-settings.ts";

const { awaited } = awaitingModule;
const { selectConfig } = configSelector;
const { isBuiltinExtension } = resourceLoader;
const { reportSettingsErrors } = trustedSettings;

function* selectPackageResources(
  settingsManager: SettingsManager,
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions,
  cwd: string,
  agentDir: string,
  local: boolean,
) {
  reportSettingsErrors(settingsManager, "config command");
  const builtinExtensions = (runtimeOptions.extensionFactories ?? [])
    .filter(isBuiltinExtension)
    .map((input) => input.name);
  const globalSettingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: false,
  });
  const globalResolvedPaths = yield* awaited(
    new DefaultPackageManager({
      agentDir,
      builtinExtensions,
      cwd,
      settingsManager: globalSettingsManager,
    }).resolution.resolve(),
  );
  const projectResolvedPaths = settingsManager.isProjectTrusted()
    ? yield* awaited(
        new DefaultPackageManager({
          agentDir,
          builtinExtensions,
          cwd,
          settingsManager,
        }).resolution.resolve(),
      )
    : globalResolvedPaths;

  yield* awaited(
    selectConfig({
      agentDir,
      cwd,
      projectModeAvailable: settingsManager.isProjectTrusted(),
      resolvedPaths: { global: globalResolvedPaths, project: projectResolvedPaths },
      settingsManager,
      writeScope: local ? "project" : "global",
    }),
  );
}

const configResources = { selectPackageResources };

export default configResources;
