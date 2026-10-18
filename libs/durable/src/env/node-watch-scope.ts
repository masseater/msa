import { Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { parentPath, pathSeparator, relativePath } from "./node-paths.ts";

export type ResolvedTarget = {
  readonly path: string;
  readonly recursive: boolean;
  readonly hidden: boolean;
  readonly names: ReadonlySet<string>;
};

export type EntryKind = "file" | "directory" | "symlink" | "other";

export type Entry = {
  readonly kind: EntryKind;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly hash?: string;
};

export type Snapshot = Map<string, Entry>;

export type Scan = { readonly snapshot: Snapshot; readonly linkedFiles: ReadonlySet<string> };

export const sameEntry: Dual2<Entry, Entry, boolean> = Function.dual(
  2,
  (a: Entry, b: Entry): boolean =>
    a.kind === b.kind &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.hash === b.hash,
);

export const ancestorsOf = (path: string): string[] => {
  const result: string[] = [];
  for (let current = parentPath(path); ; current = parentPath(current)) {
    result.push(current);
    if (parentPath(current) === current) return result;
  }
};

export const isWithin: Dual2<string, string, boolean> = Function.dual(
  2,
  (path: string, ancestor: string): boolean =>
    path === ancestor ||
    path.startsWith(ancestor.endsWith(pathSeparator) ? ancestor : ancestor + pathSeparator),
);

export const childOf: Dual2<string, string, string> = Function.dual(
  2,
  (directory: string, name: string): string =>
    `${directory.endsWith(pathSeparator) ? directory : directory + pathSeparator}${name}`,
);

export const excluded: Dual2<ResolvedTarget, string, boolean> = Function.dual(
  2,
  (target: ResolvedTarget, name: string): boolean =>
    (target.hidden && name.startsWith(".")) || target.names.has(name),
);

export const reportedPath: Dual2<readonly ResolvedTarget[], string, string> = Function.dual(
  2,
  (targets: readonly ResolvedTarget[], path: string): string => {
    if (targets.some((target) => isWithin(path, target.path))) return path;
    return targets.find((target) => isWithin(target.path, path))?.path ?? path;
  },
);

const inTarget = (target: ResolvedTarget, path: string): boolean => {
  if (isWithin(target.path, path)) return true;
  if (!isWithin(path, target.path) || path === target.path) return false;
  const components = relativePath(target.path, path).split(pathSeparator);
  if (!target.recursive && components.length > 1) return false;
  return !components.some((name) => excluded(target, name));
};

export const inScope: Dual2<readonly ResolvedTarget[], string, boolean> = Function.dual(
  2,
  (targets: readonly ResolvedTarget[], path: string): boolean =>
    targets.some((target) => inTarget(target, path)),
);

export type SnapshotChange = { readonly previous: Snapshot; readonly next: Snapshot };

export const changedPaths: Dual2<readonly ResolvedTarget[], SnapshotChange, string[]> =
  Function.dual(
    2,
    (targets: readonly ResolvedTarget[], { previous, next }: SnapshotChange): string[] => {
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
  target: ResolvedTarget,
  snapshot: Snapshot,
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

export const wantedWatchers: Dual2<
  readonly ResolvedTarget[],
  Scan,
  Map<string, boolean>
> = Function.dual(2, (targets: readonly ResolvedTarget[], scan: Scan): Map<string, boolean> => {
  const wanted = new Map<string, boolean>();
  for (const path of scan.linkedFiles) wanted.set(path, false);
  for (const target of targets) wantTarget(wanted, target, scan.snapshot);
  return wanted;
});
