import config from "../../../../config.ts";
import platform from "../../../../core/platform/index.ts";
import type settingsManagerTypes from "../../../../core/settings-manager.types.ts";
import pathsModule from "../../../../utils/paths.ts";
import type resourceListInternalTypes from "../resource-list-internal.types.ts";
import type ResourceList from "../resource-list.ts";

const { dirname, join, relative } = platform;
const { canonicalizePath, isLocalPath, resolvePath } = pathsModule;
const { CONFIG_DIR_NAME } = config;

export default class ResourcePatterns {
  private readonly list: ResourceList;

  constructor(list: ResourceList) {
    this.list = list;
  }

  getOverrideStateFromEntries(
    entries: string[],
    patterns: Set<string>,
    emptyArrayIsUnload: boolean,
  ): resourceListInternalTypes.ProjectOverrideState {
    if (entries.length === 0 && emptyArrayIsUnload) return "unload";
    let state: resourceListInternalTypes.ProjectOverrideState = "inherit";
    for (const entry of entries) {
      if (!patterns.has(this.getPatternEntryTarget(entry))) continue;
      if (entry.startsWith("!") || entry.startsWith("-")) state = "unload";
      else state = "load";
    }
    return state;
  }

  getTopLevelOverridePatterns(
    item: resourceListInternalTypes.ResourceItem,
    scope: resourceListInternalTypes.SettingsScope,
  ): Set<string> {
    const baseDir = this.getTopLevelBaseDir(scope);
    const patterns = new Set<string>([
      this.getResourcePatternForScope(item, scope),
      item.path,
      relative(baseDir, item.path),
    ]);
    if (item.metadata.baseDir !== undefined && item.metadata.baseDir !== "")
      patterns.add(relative(item.metadata.baseDir, item.path));
    return patterns;
  }

  getResourcePatternForScope(
    item: resourceListInternalTypes.ResourceItem,
    scope: resourceListInternalTypes.SettingsScope,
  ): string {
    const sourceScope = this.getItemScope(item);
    if (scope !== sourceScope || item.metadata.source === "builtin") return item.path;
    const baseDir = item.metadata.baseDir ?? this.getTopLevelBaseDir(sourceScope);
    return relative(baseDir, item.path);
  }

  createPackageOverrideSource(
    item: resourceListInternalTypes.ResourceItem,
  ): settingsManagerTypes.PackageSource {
    const source = item.metadata.source;
    if (!isLocalPath(source)) return { autoload: false, source };
    const sourcePath = resolvePath(source, this.getTopLevelBaseDir(this.getItemScope(item)), {
      trim: true,
    });
    return {
      autoload: false,
      source: relative(this.getTopLevelBaseDir("project"), sourcePath) || ".",
    };
  }

  packageSourceStringMatches(
    leftSource: string,
    leftScope: resourceListInternalTypes.SettingsScope,
    rightSource: string,
    rightScope: resourceListInternalTypes.SettingsScope,
  ): boolean {
    if (leftSource === rightSource) return true;
    if (!isLocalPath(leftSource) || !isLocalPath(rightSource)) return false;
    const left = resolvePath(leftSource, this.getTopLevelBaseDir(leftScope), { trim: true });
    const right = resolvePath(rightSource, this.getTopLevelBaseDir(rightScope), { trim: true });
    return left === right;
  }

  getPatternEntryTarget(entry: string): string {
    return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")
      ? entry.slice(1)
      : entry;
  }

  getResourceItemKey(item: resourceListInternalTypes.ResourceItem): string {
    return `${item.resourceType}:${canonicalizePath(item.path)}`;
  }

  getItemScope(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.SettingsScope {
    return item.metadata.scope === "project" ? "project" : "user";
  }

  private getTopLevelBaseDir(scope: "user" | "project"): string {
    return scope === "project" ? join(this.list.cwd, CONFIG_DIR_NAME) : this.list.agentDir;
  }

  getResourcePattern(item: resourceListInternalTypes.ResourceItem): string {
    if (item.metadata.source === "builtin") return item.path;
    const scope = item.metadata.scope as "user" | "project";
    const baseDir = item.metadata.baseDir ?? this.getTopLevelBaseDir(scope);
    return relative(baseDir, item.path);
  }

  getPackageResourcePattern(item: resourceListInternalTypes.ResourceItem): string {
    const baseDir = item.metadata.baseDir ?? dirname(item.path);
    return relative(baseDir, item.path);
  }

  findMatchingPackageSource(
    item: resourceListInternalTypes.ResourceItem,
    targetScope: resourceListInternalTypes.SettingsScope,
  ): settingsManagerTypes.PackageSource | undefined {
    const settings =
      targetScope === "project"
        ? this.list.settingsManager.getProjectSettings()
        : this.list.settingsManager.getGlobalSettings();
    return (settings.packages ?? []).find((pkg) =>
      this.packageSourceStringMatches(
        item.metadata.source,
        this.getItemScope(item),
        typeof pkg === "string" ? pkg : pkg.source,
        targetScope,
      ),
    );
  }
}
