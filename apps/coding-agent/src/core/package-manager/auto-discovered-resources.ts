import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platform from "../platform/index.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";
import sourceInfo from "../source-info.ts";
import packageEnv from "./package-env.ts";
import resourceEntries from "./resource-entries.ts";
import resourcePatterns from "./resource-patterns.ts";

const { dirname, join, resolve } = platform;
const { getHomeDir } = packageEnv;
const {
  collectAncestorAgentsSkillDirs,
  collectAutoExtensionEntries,
  collectAutoPromptEntries,
  collectAutoSkillEntries,
  collectAutoThemeEntries,
} = resourceEntries;
const { isEnabledByOverrides, applyAutoloadDisabledPatterns, getOverridePatterns } =
  resourcePatterns;

type ResourceKind = defaultPackageManagerInternalTypes.ResourceType;

type DiscoveryScope = {
  baseDir: string;
  metadata: packageManagerTypes.PathMetadata;
  overrides: (settings: ResourceKind) => string[];
  agentsSkillDirs: string[];
  enabled: boolean;
};

const collectors: Record<
  "extensions" | "prompts" | "skills" | "themes",
  (dir: string) => Promise<string[]>
> = {
  extensions: (dir) => collectAutoExtensionEntries(dir),
  prompts: (dir) => collectAutoPromptEntries(dir),
  skills: (dir) => collectAutoSkillEntries(dir, "msa"),
  themes: (dir) => collectAutoThemeEntries(dir),
};

function discoveryScope(
  settings: settingsSchemaTypes.Settings,
  baseDir: string,
  scope: packageManagerTypes.PathMetadata["scope"],
  options: { enabled: boolean; agentsSkillDirs: string[] },
): DiscoveryScope {
  return {
    ...options,
    baseDir,
    metadata: { baseDir, origin: "top-level", scope, source: "auto" },
    overrides: (kind) => (settings[kind as keyof settingsSchemaTypes.Settings] ?? []) as string[],
  };
}

const { BUILTIN_PATH_PREFIX } = sourceInfo;

export default class AutoDiscoveredResources {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  addAutoDiscoveredResources(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    globalSettings: ReturnType<settingsManagerTypes.SettingsManager["getGlobalSettings"]>,
    projectSettings: ReturnType<settingsManagerTypes.SettingsManager["getProjectSettings"]>,
    globalBaseDir: string,
    projectBaseDir: string,
  ): Promise<void> {
    const userAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
    const projectTrusted = this.manager.settingsManager.isProjectTrusted();
    const projectAgentsSkillDirs = projectTrusted
      ? collectAncestorAgentsSkillDirs(this.manager.cwd).then((dirs) =>
          dirs.filter((dir) => resolve(dir) !== resolve(userAgentsSkillsDir)),
        )
      : Promise.resolve([]);
    return projectAgentsSkillDirs
      .then((agentsSkillDirs) =>
        this.addScope(
          accumulator,
          discoveryScope(projectSettings, projectBaseDir, "project", {
            agentsSkillDirs,
            enabled: projectTrusted,
          }),
        ),
      )
      .then(() =>
        this.addScope(
          accumulator,
          discoveryScope(globalSettings, globalBaseDir, "user", {
            agentsSkillDirs: [userAgentsSkillsDir],
            enabled: true,
          }),
        ),
      );
  }

  private addScope(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    scope: DiscoveryScope,
  ): Promise<void> {
    const location = { baseDir: scope.baseDir, metadata: scope.metadata };
    const own = (kinds: readonly (keyof typeof collectors)[]) =>
      scope.enabled
        ? Promise.all(kinds.map((kind) => collectors[kind](join(scope.baseDir, kind)))).then(
            (found) => kinds.map((kind, index) => ({ kind, location, paths: found[index]! })),
          )
        : Promise.resolve([]);
    const agents = Promise.all(
      scope.agentsSkillDirs.map((agentsSkillsDir) => {
        const baseDir = dirname(agentsSkillsDir);
        return collectAutoSkillEntries(agentsSkillsDir, "agents").then((paths) => ({
          kind: "skills" as const,
          location: { baseDir, metadata: { ...scope.metadata, baseDir } },
          paths,
        }));
      }),
    );
    return Promise.all([own(["extensions", "skills"]), agents, own(["prompts", "themes"])]).then(
      (groups) => {
        for (const { kind, location: at, paths } of groups.flat())
          this.addResources(accumulator, kind, paths, scope, at);
        return undefined;
      },
    );
  }

  private addResources(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    kind: ResourceKind,
    paths: string[],
    scope: DiscoveryScope,
    location: { baseDir: string; metadata: packageManagerTypes.PathMetadata },
  ): void {
    const { collection } = this.manager.resources;
    const target = collection.getTargetMap(accumulator, kind);
    const overrides = scope.overrides(kind);
    for (const path of paths) {
      const enabled = isEnabledByOverrides(path, overrides, location.baseDir);
      collection.addResource(target, path, location.metadata, enabled);
    }
  }

  addBuiltinExtensions(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    scopes: {
      globalBaseDir: string;
      globalSettings: settingsSchemaTypes.Settings;
      projectBaseDir: string;
      projectSettings: settingsSchemaTypes.Settings;
    },
  ): void {
    const { globalBaseDir, globalSettings, projectBaseDir, projectSettings } = scopes;
    for (const name of this.manager.builtinExtensions) {
      const path = `${BUILTIN_PATH_PREFIX}${name}`;
      const projectEnabled = applyAutoloadDisabledPatterns(
        [path],
        getOverridePatterns(projectSettings.extensions ?? []),
        projectBaseDir,
      ).get(path);
      this.manager.resources.collection.addResource(
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
  }
}
