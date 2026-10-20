import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer7 from "./default-package-manager-layer-7.ts";
import manifestModule from "./manifest.ts";
import type manifestTypes from "./manifest.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { existsSync, statSync } = nodeFs;
const { dirname, join, resolve } = platformNode;
const { readMsaManifest } = manifestModule;
const {
  RESOURCE_TYPES,
  collectAncestorAgentsSkillDirs,
  collectAutoExtensionEntries,
  collectAutoPromptEntries,
  collectAutoSkillEntries,
  collectAutoThemeEntries,
  collectResourceFiles,
  getHomeDir,
  isEnabledByOverrides,
} = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer8 extends DefaultPackageManagerLayer7 {
  protected resolveLocalExtensionSource(
    source: defaultPackageManagerInternalTypes.LocalSource,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
    baseDir: string,
  ): void {
    const resolved = this.resolvePathFromBase(source.path, baseDir);
    if (!existsSync(resolved)) {
      return;
    }

    try {
      const stats = statSync(resolved);
      if (stats.isFile()) {
        metadata.baseDir = dirname(resolved);
        this.addResource(accumulator.extensions, resolved, metadata, true);
        return;
      }
      if (stats.isDirectory()) {
        metadata.baseDir = resolved;
        metadata.packageRoot = resolved;
        const resources = this.collectPackageResources(resolved, accumulator, filter, metadata);
        if (!resources) {
          this.addResource(accumulator.extensions, resolved, metadata, true);
        }
      }
    } catch {
      return undefined;
    }
  }

  protected collectPackageResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
  ): boolean {
    if (filter !== undefined) {
      for (const resourceType of RESOURCE_TYPES) {
        const patterns = filter[resourceType];
        const target = this.getTargetMap(accumulator, resourceType);
        if (filter.autoload === false) {
          this.applyPackageDeltaFilter(packageRoot, patterns ?? [], resourceType, target, metadata);
        } else if (patterns === undefined) {
          this.collectDefaultResources(packageRoot, resourceType, target, metadata);
        } else {
          this.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
        }
      }
      return true;
    }

    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    if (manifest !== null) {
      for (const resourceType of RESOURCE_TYPES) {
        const entries = manifest[resourceType as keyof manifestTypes.MsaManifest];
        this.addManifestEntries(
          entries,
          packageRoot,
          resourceType,
          this.getTargetMap(accumulator, resourceType),
          metadata,
        );
      }
      return true;
    }

    let hasAnyDir = false;
    for (const resourceType of RESOURCE_TYPES) {
      const dir = join(packageRoot, resourceType);
      if (existsSync(dir)) {
        const files = collectResourceFiles(dir, resourceType);
        for (const f of files) {
          this.addResource(this.getTargetMap(accumulator, resourceType), f, metadata, true);
        }
        hasAnyDir = true;
      }
    }
    return hasAnyDir;
  }

  protected addAutoDiscoveredResources(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    globalSettings: ReturnType<settingsManagerTypes.SettingsManager["getGlobalSettings"]>,
    projectSettings: ReturnType<settingsManagerTypes.SettingsManager["getProjectSettings"]>,
    globalBaseDir: string,
    projectBaseDir: string,
  ): void {
    const userMetadata: packageManagerTypes.PathMetadata = {
      baseDir: globalBaseDir,
      origin: "top-level",
      scope: "user",
      source: "auto",
    };
    const projectMetadata: packageManagerTypes.PathMetadata = {
      baseDir: projectBaseDir,
      origin: "top-level",
      scope: "project",
      source: "auto",
    };

    const {
      projectTrusted,
      addResources,
      projectDirs,
      projectOverrides,
      projectAgentsSkillDirs,
      userDirs,
      userOverrides,
      userAgentsSkillsDir,
    } = this.addAutoDiscoveredResourcesPart1(
      globalSettings,
      projectSettings,
      globalBaseDir,
      projectBaseDir,
      accumulator,
    );

    if (projectTrusted) {
      addResources(
        "extensions",
        collectAutoExtensionEntries(projectDirs.extensions),
        projectMetadata,
        projectOverrides.extensions,
        projectBaseDir,
      );

      addResources(
        "skills",
        collectAutoSkillEntries(projectDirs.skills, "msa"),
        projectMetadata,
        projectOverrides.skills,
        projectBaseDir,
      );
    }

    for (const agentsSkillsDir of projectAgentsSkillDirs) {
      const agentsBaseDir = dirname(agentsSkillsDir);
      const agentsMetadata: packageManagerTypes.PathMetadata = {
        ...projectMetadata,
        baseDir: agentsBaseDir,
      };
      addResources(
        "skills",
        collectAutoSkillEntries(agentsSkillsDir, "agents"),
        agentsMetadata,
        projectOverrides.skills,
        agentsBaseDir,
      );
    }

    if (projectTrusted) {
      addResources(
        "prompts",
        collectAutoPromptEntries(projectDirs.prompts),
        projectMetadata,
        projectOverrides.prompts,
        projectBaseDir,
      );
      addResources(
        "themes",
        collectAutoThemeEntries(projectDirs.themes),
        projectMetadata,
        projectOverrides.themes,
        projectBaseDir,
      );
    }

    addResources(
      "extensions",
      collectAutoExtensionEntries(userDirs.extensions),
      userMetadata,
      userOverrides.extensions,
      globalBaseDir,
    );

    addResources(
      "skills",
      collectAutoSkillEntries(userDirs.skills, "msa"),
      userMetadata,
      userOverrides.skills,
      globalBaseDir,
    );

    const userAgentsBaseDir = dirname(userAgentsSkillsDir);
    const userAgentsMetadata: packageManagerTypes.PathMetadata = {
      ...userMetadata,
      baseDir: userAgentsBaseDir,
    };
    addResources(
      "skills",
      collectAutoSkillEntries(userAgentsSkillsDir, "agents"),
      userAgentsMetadata,
      userOverrides.skills,
      userAgentsBaseDir,
    );

    addResources(
      "prompts",
      collectAutoPromptEntries(userDirs.prompts),
      userMetadata,
      userOverrides.prompts,
      globalBaseDir,
    );
    addResources(
      "themes",
      collectAutoThemeEntries(userDirs.themes),
      userMetadata,
      userOverrides.themes,
      globalBaseDir,
    );
  }

  private addAutoDiscoveredResourcesPart1(
    globalSettings: settingsSchemaTypes.Settings,
    projectSettings: settingsSchemaTypes.Settings,
    globalBaseDir: string,
    projectBaseDir: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
  ) {
    const userOverrides = {
      extensions: (globalSettings.extensions ?? []) as string[],
      prompts: (globalSettings.prompts ?? []) as string[],
      skills: (globalSettings.skills ?? []) as string[],
      themes: (globalSettings.themes ?? []) as string[],
    };
    const projectOverrides = {
      extensions: (projectSettings.extensions ?? []) as string[],
      prompts: (projectSettings.prompts ?? []) as string[],
      skills: (projectSettings.skills ?? []) as string[],
      themes: (projectSettings.themes ?? []) as string[],
    };

    const userDirs = {
      extensions: join(globalBaseDir, "extensions"),
      prompts: join(globalBaseDir, "prompts"),
      skills: join(globalBaseDir, "skills"),
      themes: join(globalBaseDir, "themes"),
    };
    const projectDirs = {
      extensions: join(projectBaseDir, "extensions"),
      prompts: join(projectBaseDir, "prompts"),
      skills: join(projectBaseDir, "skills"),
      themes: join(projectBaseDir, "themes"),
    };
    const userAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
    const projectTrusted = this.settingsManager.isProjectTrusted();
    const projectAgentsSkillDirs = projectTrusted
      ? collectAncestorAgentsSkillDirs(this.cwd).filter(
          (dir) => resolve(dir) !== resolve(userAgentsSkillsDir),
        )
      : [];

    const addResources = (
      resourceType: defaultPackageManagerInternalTypes.ResourceType,
      paths: string[],
      metadata: packageManagerTypes.PathMetadata,
      overrides: string[],
      baseDir: string,
    ) => {
      const target = this.getTargetMap(accumulator, resourceType);
      for (const path of paths) {
        const enabled = isEnabledByOverrides(path, overrides, baseDir);
        this.addResource(target, path, metadata, enabled);
      }
    };
    return {
      addResources,
      projectAgentsSkillDirs,
      projectDirs,
      projectOverrides,
      projectTrusted,
      userAgentsSkillsDir,
      userDirs,
      userOverrides,
    };
  }
}
