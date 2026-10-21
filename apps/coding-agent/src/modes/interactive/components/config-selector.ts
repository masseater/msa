import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../../../config.ts";
import type packageManagerTypes from "../../../core/package-manager.types.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import sourceInfo from "../../../core/source-info.ts";
import pathsModule from "../../../utils/paths.ts";
import pathModule from "../../path.ts";
import ConfigSelectorHeader from "./config-selector-header.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import DynamicBorder from "./dynamic-border.ts";
import ResourceList from "./resource-list.ts";

const { abbreviateHomePath } = pathsModule;
const { CONFIG_DIR_NAME } = config;
const { basename, dirname } = pathModule;
const { BUILTIN_PATH_PREFIX } = sourceInfo;
const { Spacer } = tui;

type ResourceType = "extensions" | "skills" | "prompts" | "themes";
const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  extensions: "Extensions",
  prompts: "Prompts",
  skills: "Skills",
  themes: "Themes",
};
interface ResourceItem {
  path: string;
  enabled: boolean;
  metadata: packageManagerTypes.PathMetadata;
  resourceType: ResourceType;
  displayName: string;
  groupKey: string;
  subgroupKey: string;
}
interface ResourceSubgroup {
  type: ResourceType;
  label: string;
  items: ResourceItem[];
}
interface ResourceGroup {
  key: string;
  label: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  source: string;
  subgroups: ResourceSubgroup[];
}
function formatBaseDir(baseDir: string): string {
  const displayPath = abbreviateHomePath(baseDir).replace(/\\/gu, "/");
  return displayPath.endsWith("/") ? displayPath : `${displayPath}/`;
}
function getGroupLabel(metadata: packageManagerTypes.PathMetadata, agentDir: string): string {
  if (metadata.origin === "package") {
    return `${metadata.source} (${metadata.scope})`;
  }
  if (metadata.source === "builtin") {
    return metadata.scope === "user" ? "Built-in" : "Built-in (project override)";
  }
  if (metadata.source === "auto") {
    if (metadata.baseDir !== undefined && metadata.baseDir !== "") {
      return metadata.scope === "user"
        ? `User (${formatBaseDir(metadata.baseDir)})`
        : `Project (${formatBaseDir(metadata.baseDir)})`;
    }
    return metadata.scope === "user"
      ? `User (${formatBaseDir(agentDir)})`
      : `Project (${CONFIG_DIR_NAME}/)`;
  }
  return metadata.scope === "user" ? "User settings" : "Project settings";
}
function buildGroups(
  resolved: packageManagerTypes.ResolvedPaths,
  agentDir: string,
): ResourceGroup[] {
  const groupMap = new Map<string, ResourceGroup>();

  const addToGroup = (
    resources: packageManagerTypes.ResolvedResource[],
    resourceType: ResourceType,
  ) => {
    for (const res of resources) {
      const { path, enabled, metadata } = res;
      const { group, groupKey, subgroupKey } = groupForResource(
        metadata,
        groupMap,
        agentDir,
        resourceType,
      );

      let subgroup = group.subgroups.find((sg) => sg.type === resourceType);
      if (subgroup === undefined) {
        subgroup = {
          items: [],
          label: RESOURCE_TYPE_LABELS[resourceType],
          type: resourceType,
        };
        group.subgroups.push(subgroup);
      }

      const fileName = basename(path);
      const parentFolder = basename(dirname(path));
      let displayName: string = resourceDisplayName(
        metadata,
        path,
        resourceType,
        parentFolder,
        fileName,
      );
      subgroup.items.push({
        displayName,
        enabled,
        groupKey,
        metadata,
        path,
        resourceType,
        subgroupKey,
      });
    }
  };

  return sortedGroups(addToGroup, resolved, groupMap);
}
export default class ConfigSelectorComponent extends tui.Container implements tuiTypes.Focusable {
  private header: ConfigSelectorHeader;
  private resourceList: ResourceList;
  private writeScope: configSelectorTypes.ConfigWriteScope;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.resourceList.focused = value;
  }

  constructor(
    resolvedPaths: configSelectorTypes.ScopedResolvedPaths,
    settingsManager: settingsManagerTypes.SettingsManager,
    cwd: string,
    agentDir: string,
    onClose: () => void,
    onExit: () => void,
    requestRender: () => void,
    terminalHeight?: number,
    writeScope: configSelectorTypes.ConfigWriteScope = "global",
    projectModeAvailable = true,
  ) {
    super();

    this.writeScope = writeScope;
    const groupsByScope = {
      global: buildGroups(resolvedPaths.global, agentDir),
      project: buildGroups(resolvedPaths.project, agentDir),
    };

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.header = new ConfigSelectorHeader(this.writeScope, projectModeAvailable);
    this.addChild(this.header);
    this.addChild(new Spacer(1));

    this.resourceList = new ResourceList(
      groupsByScope,
      settingsManager,
      cwd,
      agentDir,
      terminalHeight,
      this.writeScope,
    );
    this.resourceList.onCancel = onClose;
    this.resourceList.onExit = onExit;
    this.resourceList.onToggle = () => requestRender();
    if (projectModeAvailable) {
      this.resourceList.onSwitchMode = () => {
        this.switchWriteScope();
        requestRender();
      };
    }
    this.addChild(this.resourceList);

    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  private switchWriteScope(): void {
    this.writeScope = this.writeScope === "global" ? "project" : "global";
    this.header.setWriteScope(this.writeScope);
    this.resourceList.setWriteScope(this.writeScope);
  }

  getResourceList(): ResourceList {
    return this.resourceList;
  }
}
function groupForResource(
  metadata: packageManagerTypes.PathMetadata,
  groupMap: Map<string, ResourceGroup>,
  agentDir: string,
  resourceType: string,
) {
  const groupKey = `${metadata.origin}:${metadata.scope}:${metadata.source}:${metadata.baseDir ?? ""}`;

  ensureGroup(groupMap, groupKey, metadata, agentDir);

  const group = groupMap.get(groupKey)!;
  const subgroupKey = `${groupKey}:${resourceType}`;
  return { group, groupKey, subgroupKey };
}
function resourceDisplayName(
  metadata: packageManagerTypes.PathMetadata,
  path: string,
  resourceType: string,
  parentFolder: string,
  fileName: string,
) {
  let displayName: string;
  if (metadata.source === "builtin") {
    displayName = path.slice(BUILTIN_PATH_PREFIX.length);
  } else if (resourceType === "extensions" && parentFolder !== "extensions") {
    displayName = `${parentFolder}/${fileName}`;
  } else if (resourceType === "skills" && fileName === "SKILL.md") {
    displayName = parentFolder;
  } else {
    displayName = fileName;
  }
  return displayName;
}
function ensureGroup(
  groupMap: Map<string, ResourceGroup>,
  groupKey: string,
  metadata: packageManagerTypes.PathMetadata,
  agentDir: string,
) {
  if (!groupMap.has(groupKey)) {
    groupMap.set(groupKey, {
      key: groupKey,
      label: getGroupLabel(metadata, agentDir),
      origin: metadata.origin,
      scope: metadata.scope,
      source: metadata.source,
      subgroups: [],
    });
  }
}
function sortedGroups(
  addToGroup: (
    resources: packageManagerTypes.ResolvedResource[],
    resourceType: ResourceType,
  ) => void,
  resolved: packageManagerTypes.ResolvedPaths,
  groupMap: Map<string, ResourceGroup>,
) {
  addToGroup(resolved.extensions, "extensions");
  addToGroup(resolved.skills, "skills");
  addToGroup(resolved.prompts, "prompts");
  addToGroup(resolved.themes, "themes");

  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => {
    if (a.origin !== b.origin) {
      return a.origin === "package" ? -1 : 1;
    }
    if (a.scope !== b.scope) {
      return a.scope === "user" ? -1 : 1;
    }
    return a.source.localeCompare(b.source);
  });

  const typeOrder: Record<ResourceType, number> = {
    extensions: 0,
    prompts: 2,
    skills: 1,
    themes: 3,
  };
  for (const group of groups) {
    group.subgroups.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
    for (const subgroup of group.subgroups) {
      subgroup.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
  }

  return groups;
}
