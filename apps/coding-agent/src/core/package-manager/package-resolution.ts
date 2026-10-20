import * as Effect from "effect/Effect";

import config from "../../config.ts";
import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";
import sourceInfo from "../source-info.ts";

const { join } = platformNode;
const { CONFIG_DIR_NAME } = config;
const { awaitingWith, performed } = awaitingModule;
const { BUILTIN_PATH_PREFIX } = sourceInfo;

export default class PackageResolution {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  resolveExtensionSources(
    sources: string[],
    options?: { local?: boolean; temporary?: boolean },
  ): Promise<packageManagerTypes.ResolvedPaths> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const accumulator = this.manager.resources.collection.createAccumulator();
        const scope: packageManagerTypes.SourceScope =
          options?.temporary === true ? "temporary" : options?.local === true ? "project" : "user";
        for (const source of sources.filter((candidate) =>
          candidate.startsWith(BUILTIN_PATH_PREFIX),
        )) {
          this.manager.resources.collection.addResource(
            accumulator.extensions,
            source,
            { origin: "top-level", scope, source: "builtin" },
            true,
          );
        }
        const packageSources = sources
          .filter((source) => !source.startsWith(BUILTIN_PATH_PREFIX))
          .map((source) => ({ pkg: source as settingsManagerTypes.PackageSource, scope }));
        yield* performed(
          this.manager.resources.packages.resolvePackageSources(packageSources, accumulator),
        );
        return this.manager.resources.collection.toResolvedPaths(accumulator);
      }, this),
    );
  }

  resolve(
    onMissing?: (source: string) => Promise<packageManagerTypes.MissingSourceAction>,
  ): Promise<packageManagerTypes.ResolvedPaths> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const accumulator = this.manager.resources.collection.createAccumulator();
        const globalSettings = this.manager.settingsManager.getGlobalSettings();
        const projectSettings = this.manager.settingsManager.getProjectSettings();

        const allPackages: Array<{
          pkg: settingsManagerTypes.PackageSource;
          scope: packageManagerTypes.SourceScope;
        }> = [];
        for (const pkg of projectSettings.packages ?? []) {
          allPackages.push({ pkg, scope: "project" });
        }
        const { globalBaseDir, projectBaseDir } = yield* this.resolveConfiguredResources(
          globalSettings,
          allPackages,
          accumulator,
          onMissing,
          projectSettings,
        );

        this.manager.resources.autoDiscovery.addAutoDiscoveredResources(
          accumulator,
          globalSettings,
          projectSettings,
          globalBaseDir,
          projectBaseDir,
        );

        this.manager.resources.autoDiscovery.addBuiltinExtensions(accumulator, {
          globalBaseDir,
          globalSettings,
          projectBaseDir,
          projectSettings,
        });
        return this.manager.resources.collection.toResolvedPaths(accumulator);
      }, this),
    );
  }

  private *resolveConfiguredResources(
    globalSettings: settingsSchemaTypes.Settings,
    allPackages: {
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }[],
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    onMissing: ((source: string) => Promise<packageManagerTypes.MissingSourceAction>) | undefined,
    projectSettings: settingsSchemaTypes.Settings,
  ) {
    for (const pkg of globalSettings.packages ?? []) {
      allPackages.push({ pkg, scope: "user" });
    }

    const packageSources = this.manager.configured.dedupePackages(allPackages);
    yield* performed(
      this.manager.resources.packages.resolvePackageSources(packageSources, accumulator, onMissing),
    );

    const globalBaseDir = this.manager.agentDir;
    const projectBaseDir = join(this.manager.cwd, CONFIG_DIR_NAME);

    this.manager.resources.collection.resolveTopLevelEntries(accumulator, [
      { baseDir: projectBaseDir, scope: "project", settings: projectSettings },
      { baseDir: globalBaseDir, scope: "user", settings: globalSettings },
    ]);
    return { globalBaseDir, projectBaseDir };
  }
}
