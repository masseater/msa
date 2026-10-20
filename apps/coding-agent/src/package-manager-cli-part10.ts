import configSelector from "./cli/config-selector.ts";
import awaitingModule from "./core/awaiting.ts";
import DefaultPackageManager from "./core/default-package-manager.ts";
import resourceLoader from "./core/resource-loader.ts";
import SettingsManager from "./core/settings-manager.ts";
import packageManagerCliPart1 from "./package-manager-cli-part1.ts";
import type packageManagerCliTypes from "./package-manager-cli.types.ts";

const { isBuiltinExtension } = resourceLoader;
const { awaited } = awaitingModule;
const { selectConfig } = configSelector;
const { reportSettingsErrors } = packageManagerCliPart1;

function* handleConfigCommandImplPart1(
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

const packageManagerCliPart10 = {
  handleConfigCommandImplPart1,
};

export default packageManagerCliPart10;
