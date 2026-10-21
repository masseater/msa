import type packageManagerTypes from "./package-manager.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const BUILTIN_PATH_PREFIX = "builtin:";

function getSyntheticPathSource(path: string): string | undefined {
  if (path.startsWith(BUILTIN_PATH_PREFIX)) return "builtin";
  if (path.startsWith("<") && path.endsWith(">"))
    return path.slice(1, -1).split(":")[0] || "temporary";
  return undefined;
}

function isSyntheticPath(path: string): boolean {
  return path.startsWith(BUILTIN_PATH_PREFIX) || path.startsWith("<");
}

function createSourceInfo(
  path: string,
  metadata: packageManagerTypes.PathMetadata,
): sourceInfoTypes.SourceInfo {
  return {
    baseDir: metadata.baseDir,
    origin: metadata.origin,
    path,
    scope: metadata.scope,
    source: metadata.source,
  };
}

function createSyntheticSourceInfo(
  path: string,
  options: {
    source: string;
    scope?: sourceInfoTypes.SourceScope;
    origin?: sourceInfoTypes.SourceOrigin;
    baseDir?: string | undefined;
  },
): sourceInfoTypes.SourceInfo {
  return {
    baseDir: options.baseDir,
    origin: options.origin ?? "top-level",
    path,
    scope: options.scope ?? "temporary",
    source: options.source,
  };
}

const sourceInfo = {
  BUILTIN_PATH_PREFIX,
  createSourceInfo,
  createSyntheticSourceInfo,
  getSyntheticPathSource,
  isSyntheticPath,
};

export default sourceInfo;
