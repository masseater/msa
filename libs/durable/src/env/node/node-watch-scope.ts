import { Function } from "effect";

import type dualTypes from "../../dual.ts";
import nodePaths from "./node-paths.ts";
import type nodeWatchScopeTypes from "./node-watch-scope.types.ts";

const { parentPath, pathSeparator, relativePath } = nodePaths;

const sameEntry: dualTypes.Dual2<nodeWatchScopeTypes.Entry, nodeWatchScopeTypes.Entry, boolean> =
  Function.dual(
    2,
    (a: nodeWatchScopeTypes.Entry, b: nodeWatchScopeTypes.Entry): boolean =>
      a.kind === b.kind &&
      a.dev === b.dev &&
      a.ino === b.ino &&
      a.size === b.size &&
      a.mtimeMs === b.mtimeMs &&
      a.hash === b.hash,
  );

const ancestorsOf = (path: string): string[] => {
  const result: string[] = [];
  for (let current = parentPath(path); ; current = parentPath(current)) {
    result.push(current);
    if (parentPath(current) === current) return result;
  }
};

const isWithin: dualTypes.Dual2<string, string, boolean> = Function.dual(
  2,
  (path: string, ancestor: string): boolean =>
    path === ancestor ||
    path.startsWith(ancestor.endsWith(pathSeparator) ? ancestor : ancestor + pathSeparator),
);

const childOf: dualTypes.Dual2<string, string, string> = Function.dual(
  2,
  (directory: string, name: string): string =>
    `${directory.endsWith(pathSeparator) ? directory : directory + pathSeparator}${name}`,
);

const excluded: dualTypes.Dual2<nodeWatchScopeTypes.ResolvedTarget, string, boolean> =
  Function.dual(
    2,
    (target: nodeWatchScopeTypes.ResolvedTarget, name: string): boolean =>
      (target.hidden && name.startsWith(".")) || target.names.has(name),
  );

const reportedPath: dualTypes.Dual2<readonly nodeWatchScopeTypes.ResolvedTarget[], string, string> =
  Function.dual(
    2,
    (targets: readonly nodeWatchScopeTypes.ResolvedTarget[], path: string): string => {
      if (targets.some((target) => isWithin(path, target.path))) return path;
      return targets.find((target) => isWithin(target.path, path))?.path ?? path;
    },
  );

const inTarget = (target: nodeWatchScopeTypes.ResolvedTarget, path: string): boolean => {
  if (isWithin(target.path, path)) return true;
  if (!isWithin(path, target.path) || path === target.path) return false;
  const components = relativePath(target.path, path).split(pathSeparator);
  if (!target.recursive && components.length > 1) return false;
  return !components.some((name) => excluded(target, name));
};

const inScope: dualTypes.Dual2<readonly nodeWatchScopeTypes.ResolvedTarget[], string, boolean> =
  Function.dual(
    2,
    (targets: readonly nodeWatchScopeTypes.ResolvedTarget[], path: string): boolean =>
      targets.some((target) => inTarget(target, path)),
  );

const changedPaths: dualTypes.Dual2<
  readonly nodeWatchScopeTypes.ResolvedTarget[],
  nodeWatchScopeTypes.SnapshotChange,
  string[]
> = Function.dual(
  2,
  (
    targets: readonly nodeWatchScopeTypes.ResolvedTarget[],
    { previous, next }: nodeWatchScopeTypes.SnapshotChange,
  ): string[] => {
    const changed: string[] = [];
    for (const [path, entry] of next) {
      const before = previous.get(path);
      if (before === undefined || !sameEntry(before, entry)) {
        changed.push(reportedPath(targets, path));
      }
    }
    for (const path of previous.keys()) {
      if (!next.has(path)) changed.push(reportedPath(targets, path));
    }
    return changed;
  },
);

const wantTarget = (
  wanted: Map<string, boolean>,
  target: nodeWatchScopeTypes.ResolvedTarget,
  snapshot: nodeWatchScopeTypes.Snapshot,
): void => {
  for (const ancestor of ancestorsOf(target.path)) {
    if (snapshot.get(ancestor)?.kind === "directory" && !wanted.has(ancestor)) {
      wanted.set(ancestor, false);
    }
  }
  if (snapshot.get(target.path)?.kind !== "directory") return;
  const perDirectory = process.platform === "linux" || process.platform === "android";
  wanted.set(target.path, target.recursive && !perDirectory);
  if (!target.recursive || !perDirectory) return;
  for (const [path, entry] of snapshot) {
    if (entry.kind === "directory" && path !== target.path && isWithin(path, target.path)) {
      wanted.set(path, false);
    }
  }
};

const wantedWatchers: dualTypes.Dual2<
  readonly nodeWatchScopeTypes.ResolvedTarget[],
  nodeWatchScopeTypes.Scan,
  Map<string, boolean>
> = Function.dual(
  2,
  (
    targets: readonly nodeWatchScopeTypes.ResolvedTarget[],
    scan: nodeWatchScopeTypes.Scan,
  ): Map<string, boolean> => {
    const wanted = new Map<string, boolean>();
    for (const path of scan.linkedFiles) wanted.set(path, false);
    for (const target of targets) wantTarget(wanted, target, scan.snapshot);
    return wanted;
  },
);

const nodeWatchScope = {
  ancestorsOf,
  changedPaths,
  childOf,
  excluded,
  inScope,
  isWithin,
  reportedPath,
  sameEntry,
  wantedWatchers,
};

export default nodeWatchScope;
