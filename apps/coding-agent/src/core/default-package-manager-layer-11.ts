import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer10 from "./default-package-manager-layer-10.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";
import sourceInfo from "./source-info.ts";

const { awaitingWith, performed } = awaitingModule;
const { join } = platformNode;
const { CONFIG_DIR_NAME } = config;
const { BUILTIN_PATH_PREFIX } = sourceInfo;
const { RESOURCE_TYPES, applyAutoloadDisabledPatterns, getOverridePatterns, isEnabledByOverrides } =
  defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer11 extends DefaultPackageManagerLayer10 {
  resolve(
    onMissing?: (source: string) => Promise<packageManagerTypes.MissingSourceAction>,
  ): Promise<packageManagerTypes.ResolvedPaths> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const accumulator = this.createAccumulator();
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();

        const allPackages: Array<{
          pkg: settingsManagerTypes.PackageSource;
          scope: packageManagerTypes.SourceScope;
        }> = [];
        for (const pkg of projectSettings.packages ?? []) {
          allPackages.push({ pkg, scope: "project" });
        }
        const { globalBaseDir, projectBaseDir } = yield* this.resolvePart1(
          globalSettings,
          allPackages,
          accumulator,
          onMissing,
          projectSettings,
        );

        this.addAutoDiscoveredResources(
          accumulator,
          globalSettings,
          projectSettings,
          globalBaseDir,
          projectBaseDir,
        );

        for (const name of this.builtinExtensions) {
          const path = `${BUILTIN_PATH_PREFIX}${name}`;
          const projectEnabled = applyAutoloadDisabledPatterns(
            [path],
            getOverridePatterns(projectSettings.extensions ?? []),
            projectBaseDir,
          ).get(path);
          this.addResource(
            accumulator.extensions,
            path,
            {
              origin: "top-level",
              scope: projectEnabled === undefined ? "user" : "project",
              source: "builtin",
            },
            projectEnabled ??
              isEnabledByOverrides(path, globalSettings.extensions ?? [], globalBaseDir),
          );
        }

        return this.toResolvedPaths(accumulator);
      }, this),
    );
  }

  private *resolvePart1(
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

    const packageSources = this.dedupePackages(allPackages);
    yield* performed(this.resolvePackageSources(packageSources, accumulator, onMissing));

    const globalBaseDir = this.agentDir;
    const projectBaseDir = join(this.cwd, CONFIG_DIR_NAME);

    for (const resourceType of RESOURCE_TYPES) {
      const target = this.getTargetMap(accumulator, resourceType);
      const globalEntries = (globalSettings[resourceType] ?? []) as string[];
      const projectEntries = (projectSettings[resourceType] ?? []) as string[];
      this.resolveLocalEntries(
        projectEntries,
        resourceType,
        target,
        {
          origin: "top-level",
          scope: "project",
          source: "local",
        },
        projectBaseDir,
      );
      this.resolveLocalEntries(
        globalEntries,
        resourceType,
        target,
        {
          origin: "top-level",
          scope: "user",
          source: "local",
        },
        globalBaseDir,
      );
    }
    return { globalBaseDir, projectBaseDir };
  }
}
