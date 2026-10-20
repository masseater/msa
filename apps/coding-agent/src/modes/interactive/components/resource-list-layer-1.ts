import config from "../../../config.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import pathsModule from "../../../utils/paths.ts";
import pathModule from "../../path.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";
import ResourceListLayer0 from "./resource-list-layer-0.ts";
import ResourceList from "./resource-list.ts";

const { dirname, join, relative } = pathModule;
const { canonicalizePath, isLocalPath, resolvePath } = pathsModule;
const { CONFIG_DIR_NAME } = config;

export default abstract class ResourceListLayer1 extends ResourceListLayer0 {
  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  setWriteScope(writeScope: configSelectorTypes.ConfigWriteScope): void {
    this.writeScope = writeScope;
    this.buildFlatList();
    this.filterItems(this.searchInput.getValue());
  }

  protected get groups(): resourceListInternalTypes.ResourceGroup[] {
    return this.groupsByScope[this.writeScope];
  }

  protected buildInheritedEnabledMap(
    groups: resourceListInternalTypes.ResourceGroup[],
  ): Map<string, boolean> {
    const result = new Map<string, boolean>();
    for (const group of groups) {
      for (const subgroup of group.subgroups) {
        for (const item of subgroup.items) {
          result.set(this.getResourceItemKey(item), item.enabled);
        }
      }
    }
    return result;
  }

  protected buildFlatList(): void {
    this.flatItems = [];
    for (const group of this.groups) {
      this.flatItems.push({ group, type: "group" });
      for (const subgroup of group.subgroups) {
        this.flatItems.push({ group, subgroup, type: "subgroup" });
        for (const item of subgroup.items) {
          this.flatItems.push({ item, type: "item" });
        }
      }
    }
    this.selectedIndex = this.flatItems.findIndex((e) => e.type === "item");
    if (this.selectedIndex < 0) this.selectedIndex = 0;
  }

  protected findNextItem(fromIndex: number, direction: 1 | -1): number {
    let idx = fromIndex + direction;
    while (idx >= 0 && idx < this.filteredItems.length) {
      if (this.filteredItems[idx]?.type === "item") {
        return idx;
      }
      idx += direction;
    }
    return fromIndex;
  }

  protected filterItems(query: string): void {
    if (query.trim() === "") {
      this.filteredItems = [...this.flatItems];
      this.selectFirstItem();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matchingItems = new Set<resourceListInternalTypes.ResourceItem>();
    const matchingSubgroups = new Set<resourceListInternalTypes.ResourceSubgroup>();
    const matchingGroups = new Set<resourceListInternalTypes.ResourceGroup>();

    for (const entry of this.flatItems) {
      if (entry.type === "item") {
        const item = entry.item;
        if (
          item.displayName.toLowerCase().includes(lowerQuery) ||
          item.resourceType.toLowerCase().includes(lowerQuery) ||
          item.path.toLowerCase().includes(lowerQuery)
        ) {
          matchingItems.add(item);
        }
      }
    }

    for (const group of this.groups) {
      for (const subgroup of group.subgroups) {
        for (const item of subgroup.items) {
          if (matchingItems.has(item)) {
            matchingSubgroups.add(subgroup);
            matchingGroups.add(group);
          }
        }
      }
    }

    this.filteredItems = [];
    for (const entry of this.flatItems) {
      if (entry.type === "group" && matchingGroups.has(entry.group)) {
        this.filteredItems.push(entry);
      } else if (entry.type === "subgroup" && matchingSubgroups.has(entry.subgroup)) {
        this.filteredItems.push(entry);
      } else if (entry.type === "item" && matchingItems.has(entry.item)) {
        this.filteredItems.push(entry);
      }
    }

    this.selectFirstItem();
  }

  protected selectFirstItem(): void {
    const firstItemIndex = this.filteredItems.findIndex((e) => e.type === "item");
    this.selectedIndex = firstItemIndex >= 0 ? firstItemIndex : 0;
  }

  updateItem(item: resourceListInternalTypes.ResourceItem, enabled: boolean): void {
    item.enabled = enabled;
    for (const group of this.groups) {
      for (const subgroup of group.subgroups) {
        const found = subgroup.items.find(
          (i) => i.path === item.path && i.resourceType === item.resourceType,
        );
        if (found !== undefined) {
          found.enabled = enabled;
          return;
        }
      }
    }
  }

  invalidate(): void {}

  protected togglePackageResource(
    item: resourceListInternalTypes.ResourceItem,
    enabled: boolean,
  ): void {
    const togglePackageResourceScopeResult = ResourceList.togglePackageResourceScope(
      this as unknown as ResourceList,
      item,
      enabled,
    );
    if (togglePackageResourceScopeResult.done) return togglePackageResourceScopeResult.value;
    const { scope, packages } = togglePackageResourceScopeResult.value;

    if (scope === "project") {
      this.settingsManager.setProjectPackages(packages);
    } else {
      this.settingsManager.setPackages(packages);
    }
  }

  protected setProjectTopLevelPaths(
    key: resourceListInternalTypes.ResourceType,
    paths: string[],
  ): void {
    if (key === "extensions") this.settingsManager.setProjectExtensionPaths(paths);
    else if (key === "skills") this.settingsManager.setProjectSkillPaths(paths);
    else if (key === "prompts") this.settingsManager.setProjectPromptTemplatePaths(paths);
    else this.settingsManager.setProjectThemePaths(paths);
  }

  protected getOverrideStateFromEntries(
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

  protected getInheritedEnabled(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.inheritedEnabledByKey.get(this.getResourceItemKey(item)) ??
      (this.getItemScope(item) === "user" ? item.enabled : true)
    );
  }

  protected isInheritedGlobalItem(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.getItemScope(item) === "user" ||
      this.inheritedEnabledByKey.has(this.getResourceItemKey(item))
    );
  }

  protected getTopLevelOverridePatterns(
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

  protected getResourcePatternForScope(
    item: resourceListInternalTypes.ResourceItem,
    scope: resourceListInternalTypes.SettingsScope,
  ): string {
    const sourceScope = this.getItemScope(item);
    if (scope !== sourceScope || item.metadata.source === "builtin") return item.path;
    const baseDir = item.metadata.baseDir ?? this.getTopLevelBaseDir(sourceScope);
    return relative(baseDir, item.path);
  }

  protected createPackageOverrideSource(
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

  protected packageSourceStringMatches(
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

  protected getPatternEntryTarget(entry: string): string {
    return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")
      ? entry.slice(1)
      : entry;
  }

  protected getResourceItemKey(item: resourceListInternalTypes.ResourceItem): string {
    return `${item.resourceType}:${canonicalizePath(item.path)}`;
  }

  protected getItemScope(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.SettingsScope {
    return item.metadata.scope === "project" ? "project" : "user";
  }

  protected getTopLevelBaseDir(scope: "user" | "project"): string {
    return scope === "project" ? join(this.cwd, CONFIG_DIR_NAME) : this.agentDir;
  }

  protected getResourcePattern(item: resourceListInternalTypes.ResourceItem): string {
    if (item.metadata.source === "builtin") return item.path;
    const scope = item.metadata.scope as "user" | "project";
    const baseDir = item.metadata.baseDir ?? this.getTopLevelBaseDir(scope);
    return relative(baseDir, item.path);
  }

  getPackageResourcePattern(item: resourceListInternalTypes.ResourceItem): string {
    const baseDir = item.metadata.baseDir ?? dirname(item.path);
    return relative(baseDir, item.path);
  }
}
