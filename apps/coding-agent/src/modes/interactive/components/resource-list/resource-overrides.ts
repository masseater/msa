import type settingsManagerTypes from "../../../../core/settings-manager.types.ts";
import resourceListHelpers from "../resource-list-helpers.ts";
import type resourceListInternalTypes from "../resource-list-internal.types.ts";
import type ResourceList from "../resource-list.ts";

const { RESOURCE_TYPES } = resourceListHelpers;

export default class ResourceOverrides {
  private readonly list: ResourceList;

  constructor(list: ResourceList) {
    this.list = list;
  }

  buildInheritedEnabledMap(
    groups: resourceListInternalTypes.ResourceGroup[],
  ): Map<string, boolean> {
    const result = new Map<string, boolean>();
    for (const group of groups) {
      for (const subgroup of group.subgroups) {
        for (const item of subgroup.items) {
          result.set(this.list.patterns.getResourceItemKey(item), item.enabled);
        }
      }
    }
    return result;
  }

  private setProjectTopLevelPaths(
    key: resourceListInternalTypes.ResourceType,
    paths: string[],
  ): void {
    if (key === "extensions") this.list.settingsManager.resources.setProjectExtensionPaths(paths);
    else if (key === "skills") this.list.settingsManager.resources.setProjectSkillPaths(paths);
    else if (key === "prompts")
      this.list.settingsManager.resources.setProjectPromptTemplatePaths(paths);
    else this.list.settingsManager.resources.setProjectThemePaths(paths);
  }

  getInheritedEnabled(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.list.inheritedEnabledByKey.get(this.list.patterns.getResourceItemKey(item)) ??
      (this.list.patterns.getItemScope(item) === "user" ? item.enabled : true)
    );
  }

  isInheritedGlobalItem(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.list.patterns.getItemScope(item) === "user" ||
      this.list.inheritedEnabledByKey.has(this.list.patterns.getResourceItemKey(item))
    );
  }

  setProjectResourceOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    return item.metadata.origin === "top-level"
      ? this.setProjectTopLevelOverride(item, state)
      : this.setProjectPackageOverride(item, state);
  }

  private setProjectTopLevelOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    const current = (this.list.settingsManager.getProjectSettings()[item.resourceType] ??
      []) as string[];
    const pattern = this.isInheritedGlobalItem(item)
      ? item.path
      : this.list.patterns.getResourcePatternForScope(item, "project");
    const patterns = this.list.patterns.getTopLevelOverridePatterns(item, "project");
    const updated = current.filter((entry) => {
      const target = this.list.patterns.getPatternEntryTarget(entry);
      if (
        (entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")) &&
        patterns.has(target)
      )
        return false;
      return !(state === "inherit" && this.isInheritedGlobalItem(item) && target === pattern);
    });
    if (state !== "inherit") {
      if (
        this.isInheritedGlobalItem(item) &&
        item.metadata.source !== "builtin" &&
        !updated.includes(pattern)
      )
        updated.push(pattern);
      updated.push(`${state === "load" ? "+" : "-"}${pattern}`);
    }
    this.setProjectTopLevelPaths(item.resourceType, updated);
    return true;
  }

  private setProjectPackageOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    const packages = [
      ...(this.list.settingsManager.getProjectSettings().packages ?? []),
    ] as settingsManagerTypes.PackageSource[];
    let pkgIndex = packages.findIndex((pkg) =>
      this.list.patterns.packageSourceStringMatches(
        item.metadata.source,
        this.list.patterns.getItemScope(item),
        typeof pkg === "string" ? pkg : pkg.source,
        "project",
      ),
    );
    if (pkgIndex === -1) {
      if (state === "inherit") return false;
      packages.push(this.list.patterns.createPackageOverrideSource(item));
      pkgIndex = packages.length - 1;
    }
    let pkg = packages[pkgIndex];
    if (pkg === undefined) return false;
    if (typeof pkg === "string") {
      pkg = { source: pkg };
      packages[pkgIndex] = pkg;
    }
    const pattern = this.list.patterns.getPackageResourcePattern(item);
    const updated = ((pkg[item.resourceType] ?? []) as string[]).filter(
      (entry) => this.list.patterns.getPatternEntryTarget(entry) !== pattern,
    );
    if (state !== "inherit") updated.push(`${state === "load" ? "+" : "-"}${pattern}`);
    (pkg as Record<string, unknown>)[item.resourceType] = updated.length > 0 ? updated : undefined;
    if (!RESOURCE_TYPES.some((key) => (pkg as Record<string, unknown>)[key] !== undefined)) {
      if (pkg.autoload === false) packages.splice(pkgIndex, 1);
      else packages[pkgIndex] = pkg.source;
    }
    this.list.settingsManager.resources.setProjectPackages(packages);
    return true;
  }

  getNextOverrideState(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.ProjectOverrideState {
    const state = this.getProjectOverrideState(item);
    const inheritedEnabled = this.getInheritedEnabled(item);
    if (state === "inherit") return inheritedEnabled ? "unload" : "load";
    if (state === "unload") return inheritedEnabled ? "load" : "inherit";
    return inheritedEnabled ? "inherit" : "unload";
  }

  getProjectOverrideState(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.ProjectOverrideState {
    if (this.list.writeScope !== "project") return "inherit";
    if (item.metadata.origin === "top-level") {
      return this.list.patterns.getOverrideStateFromEntries(
        (this.list.settingsManager.getProjectSettings()[item.resourceType] ?? []) as string[],
        this.list.patterns.getTopLevelOverridePatterns(item, "project"),
        false,
      );
    }
    const pkg = this.list.patterns.findMatchingPackageSource(item, "project");
    if (typeof pkg !== "object") return "inherit";
    const entries = pkg[item.resourceType];
    if (entries === undefined) return "inherit";
    return this.list.patterns.getOverrideStateFromEntries(
      entries,
      new Set([this.list.patterns.getPackageResourcePattern(item)]),
      pkg.autoload !== false,
    );
  }
}
