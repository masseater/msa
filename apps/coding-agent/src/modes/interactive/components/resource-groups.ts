import config from "../../../config.ts";
import type packageManagerTypes from "../../../core/package-manager.types.ts";
import sourceInfo from "../../../core/source-info.ts";
import pathsModule from "../../../utils/paths.ts";
import pathModule from "../../path.ts";
import type resourceListInternalTypes from "./resource-list-internal.types.ts";

type ResourceType = resourceListInternalTypes.ResourceType;
type ResourceGroup = resourceListInternalTypes.ResourceGroup;
type ResourceSubgroup = resourceListInternalTypes.ResourceSubgroup;
type PathMetadata = packageManagerTypes.PathMetadata;

const { basename, dirname } = pathModule;

const RESOURCE_TYPES: ResourceType[] = ["extensions", "skills", "prompts", "themes"];
const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  extensions: "Extensions",
  prompts: "Prompts",
  skills: "Skills",
  themes: "Themes",
};

function formatBaseDir(baseDir: string): string {
  const displayPath = pathsModule.abbreviateHomePath(baseDir).replace(/\\/gu, "/");
  return displayPath.endsWith("/") ? displayPath : `${displayPath}/`;
}

function autoGroupLabel(metadata: PathMetadata, agentDir: string): string {
  const user = metadata.scope === "user";
  if (metadata.baseDir !== undefined && metadata.baseDir !== "") {
    const base = formatBaseDir(metadata.baseDir);
    return user ? `User (${base})` : `Project (${base})`;
  }
  return user ? `User (${formatBaseDir(agentDir)})` : `Project (${config.CONFIG_DIR_NAME}/)`;
}

function groupLabel(metadata: PathMetadata, agentDir: string): string {
  if (metadata.origin === "package") return `${metadata.source} (${metadata.scope})`;
  if (metadata.source === "builtin") {
    return metadata.scope === "user" ? "Built-in" : "Built-in (project override)";
  }
  if (metadata.source === "auto") return autoGroupLabel(metadata, agentDir);
  return metadata.scope === "user" ? "User settings" : "Project settings";
}

function displayNameOf(metadata: PathMetadata, path: string, resourceType: ResourceType): string {
  const fileName = basename(path);
  const parentFolder = basename(dirname(path));
  if (metadata.source === "builtin") return path.slice(sourceInfo.BUILTIN_PATH_PREFIX.length);
  if (resourceType === "extensions" && parentFolder !== "extensions") {
    return `${parentFolder}/${fileName}`;
  }
  if (resourceType === "skills" && fileName === "SKILL.md") return parentFolder;
  return fileName;
}

function groupFor(
  groups: Map<string, ResourceGroup>,
  metadata: PathMetadata,
  agentDir: string,
): ResourceGroup {
  const key = `${metadata.origin}:${metadata.scope}:${metadata.source}:${metadata.baseDir ?? ""}`;
  let group = groups.get(key);
  if (group === undefined) {
    group = {
      key,
      label: groupLabel(metadata, agentDir),
      origin: metadata.origin,
      scope: metadata.scope,
      source: metadata.source,
      subgroups: [],
    };
    groups.set(key, group);
  }
  return group;
}

function subgroupFor(group: ResourceGroup, type: ResourceType): ResourceSubgroup {
  let subgroup = group.subgroups.find((candidate) => candidate.type === type);
  if (subgroup === undefined) {
    subgroup = { items: [], label: RESOURCE_TYPE_LABELS[type], type };
    group.subgroups.push(subgroup);
  }
  return subgroup;
}

function compareGroups(a: ResourceGroup, b: ResourceGroup): number {
  if (a.origin !== b.origin) return a.origin === "package" ? -1 : 1;
  if (a.scope !== b.scope) return a.scope === "user" ? -1 : 1;
  return a.source.localeCompare(b.source);
}

function sortGroups(groups: ResourceGroup[]): ResourceGroup[] {
  groups.sort(compareGroups);
  for (const group of groups) {
    group.subgroups.sort((a, b) => RESOURCE_TYPES.indexOf(a.type) - RESOURCE_TYPES.indexOf(b.type));
    for (const subgroup of group.subgroups) {
      subgroup.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
  }
  return groups;
}

function buildResourceGroups(
  resolved: packageManagerTypes.ResolvedPaths,
  agentDir: string,
): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const resourceType of RESOURCE_TYPES) {
    for (const { path, enabled, metadata } of resolved[resourceType]) {
      const group = groupFor(groups, metadata, agentDir);
      subgroupFor(group, resourceType).items.push({
        displayName: displayNameOf(metadata, path, resourceType),
        enabled,
        groupKey: group.key,
        metadata,
        path,
        resourceType,
        subgroupKey: `${group.key}:${resourceType}`,
      });
    }
  }
  return sortGroups([...groups.values()]);
}

const resourceGroups = {
  buildResourceGroups,
};

export default resourceGroups;
