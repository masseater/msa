import type settingsManagerTypes from "../../../../core/settings-manager.types.ts";
import type resourceListInternalTypes from "../resource-list-internal.types.ts";
import type ResourceList from "../resource-list.ts";

export default class ResourceToggling {
  private readonly list: ResourceList;

  constructor(list: ResourceList) {
    this.list = list;
  }

  private togglePackageResource(
    item: resourceListInternalTypes.ResourceItem,
    enabled: boolean,
  ): void {
    const scope = item.metadata.scope as "user" | "project";
    const { settingsManager } = this.list;
    const settings =
      scope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    const packages = [...(settings.packages ?? [])] as settingsManagerTypes.PackageSource[];
    const pkgIndex = packages.findIndex(
      (pkg) => (typeof pkg === "string" ? pkg : pkg.source) === item.metadata.source,
    );
    const found = packages[pkgIndex];
    if (found === undefined) return;
    const pkg = typeof found === "string" ? { source: found } : found;
    packages[pkgIndex] = pkg;
    this.applyPackageResourceFilter(item, pkg, enabled, packages, pkgIndex);

    if (scope === "project") {
      settingsManager.resources.setProjectPackages(packages);
    } else {
      settingsManager.resources.setPackages(packages);
    }
  }

  private toggleTopLevelResource(
    item: resourceListInternalTypes.ResourceItem,
    enabled: boolean,
  ): void {
    const scope = item.metadata.scope as "user" | "project";
    const settings =
      scope === "project"
        ? this.list.settingsManager.getProjectSettings()
        : this.list.settingsManager.getGlobalSettings();

    const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
    const current = (settings[arrayKey] ?? []) as string[];

    const pattern = this.list.patterns.getResourcePattern(item);
    const disablePattern = `-${pattern}`;
    const enablePattern = `+${pattern}`;

    const updated = current.filter((p) => {
      const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
      return stripped !== pattern;
    });

    if (enabled) {
      updated.push(enablePattern);
    } else {
      updated.push(disablePattern);
    }

    if (scope === "project") {
      if (arrayKey === "extensions") {
        this.list.settingsManager.resources.setProjectExtensionPaths(updated);
      } else if (arrayKey === "skills") {
        this.list.settingsManager.resources.setProjectSkillPaths(updated);
      } else if (arrayKey === "prompts") {
        this.list.settingsManager.resources.setProjectPromptTemplatePaths(updated);
      } else if (arrayKey === "themes") {
        this.list.settingsManager.resources.setProjectThemePaths(updated);
      }
    } else if (arrayKey === "extensions") {
      this.list.settingsManager.resources.setExtensionPaths(updated);
    } else if (arrayKey === "skills") {
      this.list.settingsManager.resources.setSkillPaths(updated);
    } else if (arrayKey === "prompts") {
      this.list.settingsManager.resources.setPromptTemplatePaths(updated);
    } else if (arrayKey === "themes") {
      this.list.settingsManager.resources.setThemePaths(updated);
    }
  }

  toggleSelected(): void {
    const entry = this.list.filteredItems[this.list.selectedIndex];
    if (
      entry?.type === "item" &&
      (this.list.writeScope === "project" || this.list.patterns.getItemScope(entry.item) === "user")
    ) {
      const newEnabled = this.toggleResource(entry.item);
      if (newEnabled !== undefined) {
        this.list.updateItem(entry.item, newEnabled);
        this.list.onToggle?.(entry.item, newEnabled);
      }
    }
  }

  private toggleResource(item: resourceListInternalTypes.ResourceItem): boolean | undefined {
    if (this.list.writeScope === "project") {
      const state = this.list.overrides.getNextOverrideState(item);
      if (!this.list.overrides.setProjectResourceOverride(item, state)) return undefined;
      return state === "inherit" ? this.list.overrides.getInheritedEnabled(item) : state === "load";
    }

    const enabled = !item.enabled;
    if (item.metadata.origin === "top-level") {
      this.toggleTopLevelResource(item, enabled);
    } else {
      this.togglePackageResource(item, enabled);
    }
    return enabled;
  }

  applyPackageResourceFilter(
    item: resourceListInternalTypes.ResourceItem,
    pkg: {
      autoload?: boolean;
      extensions?: string[];
      prompts?: string[];
      skills?: string[];
      themes?: string[];
      source: string;
    },
    enabled: boolean,
    packages: (
      | string
      | {
          autoload?: boolean;
          extensions?: string[];
          prompts?: string[];
          skills?: string[];
          themes?: string[];
          source: string;
        }
    )[],
    pkgIndex: number,
  ) {
    const { current, pattern, enablePattern, disablePattern, arrayKey } =
      this.packageFilterPatterns(item, pkg);

    const updated = current.filter((p) => {
      const stripped = p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
      return stripped !== pattern;
    });

    if (enabled) {
      updated.push(enablePattern);
    } else {
      updated.push(disablePattern);
    }

    (pkg as Record<string, unknown>)[arrayKey] = updated.length > 0 ? updated : undefined;

    const hasFilters = (["extensions", "skills", "prompts", "themes"] as const).some(
      (k) => pkg[k] !== undefined,
    );
    if (!hasFilters) {
      packages[pkgIndex] = (pkg as { source: string }).source;
    }
  }

  packageFilterPatterns(
    item: resourceListInternalTypes.ResourceItem,
    pkg: {
      autoload?: boolean;
      extensions?: string[];
      prompts?: string[];
      skills?: string[];
      themes?: string[];
      source: string;
    },
  ) {
    const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
    const current = (pkg[arrayKey] ?? []) as string[];

    const pattern = this.list.patterns.getPackageResourcePattern(item);
    const disablePattern = `-${pattern}`;
    const enablePattern = `+${pattern}`;
    return { arrayKey, current, disablePattern, enablePattern, pattern };
  }
}
