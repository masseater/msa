import type { PathMetadata } from "./package-manager.ts";

export type SourceScope = "user" | "project" | "temporary";
export type SourceOrigin = "package" | "top-level";

export interface SourceInfo {
  path: string;
  source: string;
  scope: SourceScope;
  origin: SourceOrigin;
  baseDir?: string | undefined;
}

export const BUILTIN_PATH_PREFIX = "builtin:";

export function getSyntheticPathSource(path: string): string | undefined {
  if (path.startsWith(BUILTIN_PATH_PREFIX)) return "builtin";
  if (path.startsWith("<") && path.endsWith(">"))
    return path.slice(1, -1).split(":")[0] || "temporary";
  return undefined;
}

export function isSyntheticPath(path: string): boolean {
  return path.startsWith(BUILTIN_PATH_PREFIX) || path.startsWith("<");
}

export function createSourceInfo(path: string, metadata: PathMetadata): SourceInfo {
  return {
    baseDir: metadata.baseDir,
    origin: metadata.origin,
    path,
    scope: metadata.scope,
    source: metadata.source,
  };
}

export function createSyntheticSourceInfo(
  path: string,
  options: {
    source: string;
    scope?: SourceScope;
    origin?: SourceOrigin;
    baseDir?: string | undefined;
  },
): SourceInfo {
  return {
    baseDir: options.baseDir,
    origin: options.origin ?? "top-level",
    path,
    scope: options.scope ?? "temporary",
    source: options.source,
  };
}
