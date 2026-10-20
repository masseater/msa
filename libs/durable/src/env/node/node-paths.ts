import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import * as NodePath from "@effect/platform-node/NodePath";
import { Function, ManagedRuntime, Path } from "effect";

import FileError from "../file-error.ts";
import type fileErrorTypes from "../file-error.types.ts";
import resultModule from "../result.ts";
import type resultTypes from "../result.types.ts";
import type typesModule from "../types.ts";
import type nodePathsTypes from "./node-paths.types.ts";

const { err, ok } = resultModule;

const nodePath: Path.Path = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

const pathSeparator: string = nodePath.sep;

const joinPaths = (...parts: readonly string[]): string => nodePath.join(...parts);

const parentPath = (path: string): string => nodePath.dirname(path);

const relativePath: nodePathsTypes.Dual2<string, string, string> = Function.dual(
  2,
  (from: string, to: string): string => nodePath.relative(from, to),
);

const childPath: nodePathsTypes.Dual2<string, string, string> = Function.dual(
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

const resolvePath: nodePathsTypes.Dual2<string, string, string> = Function.dual(
  2,
  (cwd: string, input: string): string => {
    const normalized = expandHome(input);
    return nodePath.isAbsolute(normalized)
      ? nodePath.resolve(normalized)
      : nodePath.resolve(cwd, normalized);
  },
);

const fileKindOf = (stats: nodePathsTypes.StatsLike): typesModule.FileKind | undefined => {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return undefined;
};

const fileInfoFromStats: nodePathsTypes.Dual2<
  string,
  nodePathsTypes.StatsLike,
  resultTypes.Result<typesModule.FileInfo, fileErrorTypes.FileError>
> = Function.dual(
  2,
  (
    path: string,
    stats: nodePathsTypes.StatsLike,
  ): resultTypes.Result<typesModule.FileInfo, fileErrorTypes.FileError> => {
    const kind = fileKindOf(stats);
    if (kind === undefined) return err(new FileError("invalid", "Unsupported file type", path));
    return ok({
      kind,
      mtimeMs: stats.mtimeMs,
      name: nodePath.basename(path),
      path,
      size: stats.size,
    });
  },
);

const nodePaths = {
  childPath,
  fileInfoFromStats,
  joinPaths,
  parentPath,
  pathSeparator,
  relativePath,
  resolvePath,
};

export default nodePaths;
