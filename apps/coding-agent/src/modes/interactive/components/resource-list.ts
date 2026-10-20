import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";
import ResourceListLayer3 from "./resource-list-layer-3.ts";

const { Input } = tui;

export default class ResourceList
  extends ResourceListLayer3
  implements tuiTypes.Component, tuiTypes.Focusable
{
  static togglePackageResourceScope(
    self: ResourceList,
    item: resourceListInternalTypes.ResourceItem,
    enabled: boolean,
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          scope: "user" | "project";
          packages: (
            | string
            | {
                extensions?: string[];
                skills?: string[];
                prompts?: string[];
                themes?: string[];
                autoload?: boolean;
                source: string;
              }
          )[];
        };
      } {
    const scope = item.metadata.scope as "user" | "project";
    const settings =
      scope === "project"
        ? self.settingsManager.getProjectSettings()
        : self.settingsManager.getGlobalSettings();

    const packages = [...(settings.packages ?? [])] as settingsManagerTypes.PackageSource[];
    const pkgIndex = packages.findIndex((pkg) => {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      return source === item.metadata.source;
    });

    let pkg = packages[pkgIndex];
    if (pkg === undefined) return { done: true, value: undefined };

    if (typeof pkg === "string") {
      pkg = { source: pkg };
      packages[pkgIndex] = pkg;
    }

    ResourceList.togglePackageResourceScopePart1(item, pkg, self, enabled, packages, pkgIndex);
    return { done: false, value: { packages, scope } };
  }

  static togglePackageResourceScopePart1(
    item: resourceListInternalTypes.ResourceItem,
    pkg: {
      autoload?: boolean;
      extensions?: string[];
      prompts?: string[];
      skills?: string[];
      themes?: string[];
      source: string;
    },
    self: ResourceList,
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
      ResourceList.togglePackageResourceScopePart1Part1(item, pkg, self);

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

    const hasFilters = ["extensions", "skills", "prompts", "themes"].some(
      (k) => (pkg as Record<string, unknown>)[k] !== undefined,
    );
    if (!hasFilters) {
      packages[pkgIndex] = (pkg as { source: string }).source;
    }
  }

  static togglePackageResourceScopePart1Part1(
    item: resourceListInternalTypes.ResourceItem,
    pkg: {
      autoload?: boolean;
      extensions?: string[];
      prompts?: string[];
      skills?: string[];
      themes?: string[];
      source: string;
    },
    self: ResourceList,
  ) {
    const arrayKey = item.resourceType as "extensions" | "skills" | "prompts" | "themes";
    const current = (pkg[arrayKey] ?? []) as string[];

    const pattern = self.getPackageResourcePattern(item);
    const disablePattern = `-${pattern}`;
    const enablePattern = `+${pattern}`;
    return { arrayKey, current, disablePattern, enablePattern, pattern };
  }

  constructor(
    groupsByScope: Record<
      configSelectorTypes.ConfigWriteScope,
      resourceListInternalTypes.ResourceGroup[]
    >,
    settingsManager: settingsManagerTypes.SettingsManager,
    cwd: string,
    agentDir: string,
    terminalHeight?: number,
    writeScope: configSelectorTypes.ConfigWriteScope = "global",
  ) {
    super();
    this.groupsByScope = groupsByScope;
    this.settingsManager = settingsManager;
    this.cwd = cwd;
    this.agentDir = agentDir;
    this.writeScope = writeScope;
    this.inheritedEnabledByKey = this.buildInheritedEnabledMap(groupsByScope.global);
    this.searchInput = new Input();
    const chrome = 8;
    this.maxVisible = Math.max(5, (terminalHeight ?? 24) - chrome);
    this.buildFlatList();
    this.filteredItems = [...this.flatItems];
  }
}
