import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import * as NodePath from "@effect/platform-node/NodePath";
import { Function, ManagedRuntime, Path } from "effect";

import type { Dual2 } from "../dual.ts";
import { FileError } from "./file-error.ts";
import { err, ok, type Result } from "./result.ts";
import type { FileInfo, FileKind } from "./types.ts";

const nodePath: Path.Path = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

export const pathSeparator: string = nodePath.sep;

export const joinPaths = (...parts: readonly string[]): string => nodePath.join(...parts);

export const parentPath = (path: string): string => nodePath.dirname(path);

export const relativePath: Dual2<string, string, string> = Function.dual(
  2,
  (from: string, to: string): string => nodePath.relative(from, to),
);

export const childPath: Dual2<string, string, string> = Function.dual(
  2,
  (directory: string, name: string): string => nodePath.resolve(directory, name),
);

const fromFileUrl = (url: string): string => {
  try {
    return fileURLToPath(url);
  } catch {
    return url;
  }
};

const expandHome = (input: string): string => {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || (process.platform === "win32" && input.startsWith("~\\"))) {
    return nodePath.join(homedir(), input.slice(2));
  }
  return input.startsWith("file://") ? fromFileUrl(input) : input;
};

export const resolvePath: Dual2<string, string, string> = Function.dual(
  2,
  (cwd: string, input: string): string => {
    const normalized = expandHome(input);
    return nodePath.isAbsolute(normalized)
      ? nodePath.resolve(normalized)
      : nodePath.resolve(cwd, normalized);
  },
);

export type StatsLike = {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly size: number;
  readonly mtimeMs: number;
};

const fileKindOf = (stats: StatsLike): FileKind | undefined => {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return undefined;
};

export const fileInfoFromStats: Dual2<
  string,
  StatsLike,
  Result<FileInfo, FileError>
> = Function.dual(2, (path: string, stats: StatsLike): Result<FileInfo, FileError> => {
  const kind = fileKindOf(stats);
  if (kind === undefined) return err(new FileError("invalid", "Unsupported file type", path));
  return ok({
    name: nodePath.basename(path),
    path,
    kind,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  });
});
