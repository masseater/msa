import { resolvePath } from "../../utils/paths.ts";
import type { ExtensionFactory } from "./types.ts";

let extensionCacheCwd: string | undefined;
let extensionCacheGeneration = 0;

export const extensionCache = new Map<string, ExtensionFactory>();

export interface ExtensionCacheToken {
  cwd: string;
  generation: number;
}

export function clearExtensionCache(): void {
  extensionCache.clear();
  extensionCacheCwd = undefined;
  extensionCacheGeneration++;
}

export function useExtensionCacheCwd(cwd: string): ExtensionCacheToken {
  const resolvedCwd = resolvePath(cwd);
  if (extensionCacheCwd !== undefined && extensionCacheCwd !== resolvedCwd) {
    clearExtensionCache();
  }
  extensionCacheCwd = resolvedCwd;
  return { cwd: resolvedCwd, generation: extensionCacheGeneration };
}

export function isCurrentCacheToken(
  cacheToken: ExtensionCacheToken | undefined,
): cacheToken is ExtensionCacheToken {
  return (
    cacheToken !== undefined &&
    extensionCacheCwd === cacheToken.cwd &&
    extensionCacheGeneration === cacheToken.generation
  );
}
