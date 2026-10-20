import paths from "../../utils/paths.ts";
import type loaderCacheTypes from "./loader-cache.types.ts";
import type extensionsTypesTypes from "./types.types.ts";

const { resolvePath } = paths;

let extensionCacheCwd: string | undefined;
let extensionCacheGeneration = 0;

const extensionCache = new Map<string, extensionsTypesTypes.ExtensionFactory>();

function clearExtensionCache(): void {
  extensionCache.clear();
  extensionCacheCwd = undefined;
  extensionCacheGeneration++;
}

function useExtensionCacheCwd(cwd: string): loaderCacheTypes.ExtensionCacheToken {
  const resolvedCwd = resolvePath(cwd);
  if (extensionCacheCwd !== undefined && extensionCacheCwd !== resolvedCwd) {
    clearExtensionCache();
  }
  extensionCacheCwd = resolvedCwd;
  return { cwd: resolvedCwd, generation: extensionCacheGeneration };
}

function isCurrentCacheToken(
  cacheToken: loaderCacheTypes.ExtensionCacheToken | undefined,
): cacheToken is loaderCacheTypes.ExtensionCacheToken {
  return (
    cacheToken !== undefined &&
    extensionCacheCwd === cacheToken.cwd &&
    extensionCacheGeneration === cacheToken.generation
  );
}

const loaderCache = {
  clearExtensionCache,
  extensionCache,
  isCurrentCacheToken,
  useExtensionCacheCwd,
};

export default loaderCache;
