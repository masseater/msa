import type resourceLoaderTypes from "../../../core/resource-loader.types.ts";
import type sourceInfoTypes from "../../../core/source-info.types.ts";
import pathsModule from "../../../utils/paths.ts";
import type loadedResourcesInternalTypes from "../loaded-resources-internal.types.ts";
import type loadedResourcesTypes from "../loaded-resources.types.ts";
import themeModule from "../theme/theme.ts";

const { abbreviateHomePath } = pathsModule;
const { theme } = themeModule;

import resourceLabels from "./resource-labels.ts";

const { isPackageSource, getShortPath, getSourceLabel } = resourceLabels;

function getScopeName(
  sourceInfo?: sourceInfoTypes.SourceInfo,
): loadedResourcesInternalTypes.ScopeName {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

function buildScopeGroups(
  items: readonly loadedResourcesTypes.ResourceItem[],
): loadedResourcesInternalTypes.ScopeGroup[] {
  const groups: Record<
    loadedResourcesInternalTypes.ScopeName,
    loadedResourcesInternalTypes.ScopeGroup
  > = {
    path: { packages: new Map(), paths: [], scope: "path" },
    project: { packages: new Map(), paths: [], scope: "project" },
    user: { packages: new Map(), paths: [], scope: "user" },
  };

  for (const item of items) {
    const group = groups[getScopeName(item.sourceInfo)];
    if (isPackageSource(item.sourceInfo)) {
      const source = item.sourceInfo?.source ?? "local";
      const list = group.packages.get(source) ?? [];
      list.push(item);
      group.packages.set(source, list);
    } else {
      group.paths.push(item);
    }
  }

  return [groups.project, groups.user, groups.path].filter(
    (group) => group.paths.length > 0 || group.packages.size > 0,
  );
}

const byPath = (
  a: loadedResourcesTypes.ResourceItem,
  b: loadedResourcesTypes.ResourceItem,
): number => a.path.localeCompare(b.path);

function formatScopeGroups(
  groups: readonly loadedResourcesInternalTypes.ScopeGroup[],
  formatPath: (item: loadedResourcesTypes.ResourceItem) => string,
  formatPackagePath: (item: loadedResourcesTypes.ResourceItem) => string,
): string {
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(`  ${theme.fg("accent", group.scope)}`);
    for (const item of [...group.paths].sort(byPath)) {
      lines.push(theme.fg("dim", `    ${formatPath(item)}`));
    }
    const packages = [...group.packages].sort(([a], [b]) => a.localeCompare(b));
    for (const [source, items] of packages) {
      lines.push(`    ${theme.fg("mdLink", source)}`);
      for (const item of [...items].sort(byPath)) {
        lines.push(theme.fg("dim", `      ${formatPackagePath(item)}`));
      }
    }
  }
  return lines.join("\n");
}

function findSourceInfoForPath(
  p: string,
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): sourceInfoTypes.SourceInfo | undefined {
  let current = p;
  while (true) {
    const match = sourceInfos.get(current);
    if (match !== undefined) return match;
    const parentEnd = current.lastIndexOf("/");
    if (parentEnd === -1) return undefined;
    current = current.substring(0, parentEnd);
  }
}

function formatPathWithSource(
  p: string,
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): string {
  const sourceInfo = findSourceInfoForPath(p, sourceInfos);
  if (sourceInfo === undefined) return abbreviateHomePath(p);
  return `${getSourceLabel(sourceInfo)} ${getShortPath(p, sourceInfo)}`;
}

function formatDiagnostics(
  diagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[],
  sourceInfos: ReadonlyMap<string, sourceInfoTypes.SourceInfo>,
): string {
  const lines: string[] = [];
  const collisions = new Map<string, resourceLoaderTypes.ResourceDiagnostic[]>();
  const otherDiagnostics: resourceLoaderTypes.ResourceDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.type === "collision" && d.collision !== undefined) {
      const list = collisions.get(d.collision.name) ?? [];
      list.push(d);
      collisions.set(d.collision.name, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  for (const [name, collisionList] of collisions) {
    const first = collisionList[0]?.collision;
    if (first === undefined) continue;
    lines.push(theme.fg("warning", `  "${name}" collision:`));
    lines.push(
      theme.fg(
        "dim",
        `    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, sourceInfos)}`,
      ),
    );
    for (const d of collisionList) {
      if (d.collision === undefined) continue;
      lines.push(
        theme.fg(
          "dim",
          `    ${theme.fg("warning", "✗")} ${formatPathWithSource(d.collision.loserPath, sourceInfos)} (skipped)`,
        ),
      );
    }
  }

  for (const d of otherDiagnostics) {
    const color = d.type === "error" ? "error" : "warning";
    if (d.path !== undefined && d.path !== "") {
      lines.push(theme.fg(color, `  ${formatPathWithSource(d.path, sourceInfos)}`));
      lines.push(theme.fg(color, `    ${d.message}`));
    } else {
      lines.push(theme.fg(color, `  ${d.message}`));
    }
  }
  return lines.join("\n");
}

function formatCompactList(items: readonly string[], sort = true): string {
  const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (sort) {
    labels.sort((a, b) => a.localeCompare(b));
  }
  return theme.fg("dim", `  ${labels.join(", ")}`);
}

const resourceFormat = {
  buildScopeGroups,
  byPath,
  findSourceInfoForPath,
  formatCompactList,
  formatDiagnostics,
  formatPathWithSource,
  formatScopeGroups,
  getScopeName,
};

export default resourceFormat;
