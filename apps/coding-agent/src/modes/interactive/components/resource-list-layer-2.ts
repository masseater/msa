import tui from "@msa/tui";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import themeModule from "../theme/theme.ts";
import resourceListHelpers from "./resource-list-helpers.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";
import ResourceListLayer1 from "./resource-list-layer-1.ts";

const { theme } = themeModule;
const { truncateToWidth } = tui;
const { RESOURCE_TYPES } = resourceListHelpers;

export default abstract class ResourceListLayer2 extends ResourceListLayer1 {
  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...this.searchInput.render(width));
    lines.push("");

    if (this.filteredItems.length === 0) {
      lines.push(theme.fg("muted", "  No resources found"));
      return lines;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.filteredItems.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

    for (const [offset, entry] of this.filteredItems.slice(startIndex, endIndex).entries()) {
      const isSelected = startIndex + offset === this.selectedIndex;

      if (entry.type === "group") {
        const inherited = this.writeScope === "project" && entry.group.scope === "user";
        const label = theme.bold(`${entry.group.label}${inherited ? " · inherited global" : ""}`);
        const groupLine = theme.fg(inherited ? "dim" : "accent", label);
        lines.push(truncateToWidth(`  ${groupLine}`, width, ""));
      } else if (entry.type === "subgroup") {
        const color =
          this.writeScope === "project" && entry.group.scope === "user" ? "dim" : "muted";
        const subgroupLine = theme.fg(color, entry.subgroup.label);
        lines.push(truncateToWidth(`    ${subgroupLine}`, width, ""));
      } else {
        this.renderPart1(entry, isSelected, lines, width);
      }
    }

    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      const itemCount = this.filteredItems.filter((e) => e.type === "item").length;
      const currentItemIndex =
        this.filteredItems.slice(0, this.selectedIndex).filter((e) => e.type === "item").length + 1;
      lines.push(theme.fg("dim", `  (${currentItemIndex}/${itemCount})`));
    }

    return lines;
  }

  protected renderPart1(
    entry: { type: "item"; item: resourceListInternalTypes.ResourceItem },
    isSelected: boolean,
    lines: string[],
    width: number,
  ) {
    const item = entry.item;
    const cursor = isSelected ? "> " : "  ";
    const dimmed = this.isDimmedItem(item);
    const nameText = isSelected && !dimmed ? theme.bold(item.displayName) : item.displayName;
    const name = dimmed ? theme.fg("dim", nameText) : nameText;
    lines.push(
      truncateToWidth(
        `${cursor}    ${this.renderCheckbox(item)} ${name}${this.getItemSuffix(item)}`,
        width,
        "...",
      ),
    );
  }

  protected toggleTopLevelResource(
    item: resourceListInternalTypes.ResourceItem,
    enabled: boolean,
  ): void {
    const scope = item.metadata.scope as "user" | "project";
    const settings =
      scope === "project"
        ? this.settingsManager.getProjectSettings()
        : this.settingsManager.getGlobalSettings();

    const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
    const current = (settings[arrayKey] ?? []) as string[];

    const pattern = this.getResourcePattern(item);
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
        this.settingsManager.resources.setProjectExtensionPaths(updated);
      } else if (arrayKey === "skills") {
        this.settingsManager.resources.setProjectSkillPaths(updated);
      } else if (arrayKey === "prompts") {
        this.settingsManager.resources.setProjectPromptTemplatePaths(updated);
      } else if (arrayKey === "themes") {
        this.settingsManager.resources.setProjectThemePaths(updated);
      }
    } else if (arrayKey === "extensions") {
      this.settingsManager.resources.setExtensionPaths(updated);
    } else if (arrayKey === "skills") {
      this.settingsManager.resources.setSkillPaths(updated);
    } else if (arrayKey === "prompts") {
      this.settingsManager.resources.setPromptTemplatePaths(updated);
    } else if (arrayKey === "themes") {
      this.settingsManager.resources.setThemePaths(updated);
    }
  }

  protected renderCheckbox(item: resourceListInternalTypes.ResourceItem): string {
    if (this.writeScope === "project") {
      const state = this.getProjectOverrideState(item);
      if (state === "load") return theme.fg("success", "[+]");
      if (state === "unload") return theme.fg("warning", "[-]");
      return theme.fg("dim", item.enabled ? "[x]" : "[ ]");
    }
    return item.enabled ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
  }

  protected getItemSuffix(item: resourceListInternalTypes.ResourceItem): string {
    if (this.writeScope !== "project") return "";
    const state = this.getProjectOverrideState(item);
    if (state === "load") return theme.fg("muted", "  project load");
    if (state === "unload") return theme.fg("muted", "  project unload");
    return this.isInheritedGlobalItem(item) ? theme.fg("dim", "  inherited global") : "";
  }

  protected isDimmedItem(item: resourceListInternalTypes.ResourceItem): boolean {
    return (
      this.writeScope === "project" &&
      this.isInheritedGlobalItem(item) &&
      this.getProjectOverrideState(item) === "inherit"
    );
  }

  protected setProjectResourceOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    return item.metadata.origin === "top-level"
      ? this.setProjectTopLevelOverride(item, state)
      : this.setProjectPackageOverride(item, state);
  }

  protected setProjectTopLevelOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    const current = (this.settingsManager.getProjectSettings()[item.resourceType] ??
      []) as string[];
    const pattern = this.isInheritedGlobalItem(item)
      ? item.path
      : this.getResourcePatternForScope(item, "project");
    const patterns = this.getTopLevelOverridePatterns(item, "project");
    const updated = current.filter((entry) => {
      const target = this.getPatternEntryTarget(entry);
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

  protected setProjectPackageOverride(
    item: resourceListInternalTypes.ResourceItem,
    state: resourceListInternalTypes.ProjectOverrideState,
  ): boolean {
    const packages = [
      ...(this.settingsManager.getProjectSettings().packages ?? []),
    ] as settingsManagerTypes.PackageSource[];
    let pkgIndex = packages.findIndex((pkg) =>
      this.packageSourceStringMatches(
        item.metadata.source,
        this.getItemScope(item),
        typeof pkg === "string" ? pkg : pkg.source,
        "project",
      ),
    );
    if (pkgIndex === -1) {
      if (state === "inherit") return false;
      packages.push(this.createPackageOverrideSource(item));
      pkgIndex = packages.length - 1;
    }
    let pkg = packages[pkgIndex];
    if (pkg === undefined) return false;
    if (typeof pkg === "string") {
      pkg = { source: pkg };
      packages[pkgIndex] = pkg;
    }
    const pattern = this.getPackageResourcePattern(item);
    const updated = ((pkg[item.resourceType] ?? []) as string[]).filter(
      (entry) => this.getPatternEntryTarget(entry) !== pattern,
    );
    if (state !== "inherit") updated.push(`${state === "load" ? "+" : "-"}${pattern}`);
    (pkg as Record<string, unknown>)[item.resourceType] = updated.length > 0 ? updated : undefined;
    if (!RESOURCE_TYPES.some((key) => (pkg as Record<string, unknown>)[key] !== undefined)) {
      if (pkg.autoload === false) packages.splice(pkgIndex, 1);
      else packages[pkgIndex] = pkg.source;
    }
    this.settingsManager.resources.setProjectPackages(packages);
    return true;
  }

  protected getNextOverrideState(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.ProjectOverrideState {
    const state = this.getProjectOverrideState(item);
    const inheritedEnabled = this.getInheritedEnabled(item);
    if (state === "inherit") return inheritedEnabled ? "unload" : "load";
    if (state === "unload") return inheritedEnabled ? "load" : "inherit";
    return inheritedEnabled ? "inherit" : "unload";
  }

  protected getProjectOverrideState(
    item: resourceListInternalTypes.ResourceItem,
  ): resourceListInternalTypes.ProjectOverrideState {
    if (this.writeScope !== "project") return "inherit";
    if (item.metadata.origin === "top-level") {
      return this.getOverrideStateFromEntries(
        (this.settingsManager.getProjectSettings()[item.resourceType] ?? []) as string[],
        this.getTopLevelOverridePatterns(item, "project"),
        false,
      );
    }
    const pkg = this.findMatchingPackageSource(item, "project");
    if (typeof pkg !== "object") return "inherit";
    const entries = pkg[item.resourceType];
    if (entries === undefined) return "inherit";
    return this.getOverrideStateFromEntries(
      entries,
      new Set([this.getPackageResourcePattern(item)]),
      pkg.autoload !== false,
    );
  }

  protected findMatchingPackageSource(
    item: resourceListInternalTypes.ResourceItem,
    targetScope: resourceListInternalTypes.SettingsScope,
  ): settingsManagerTypes.PackageSource | undefined {
    const settings =
      targetScope === "project"
        ? this.settingsManager.getProjectSettings()
        : this.settingsManager.getGlobalSettings();
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
