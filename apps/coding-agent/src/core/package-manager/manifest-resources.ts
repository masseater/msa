import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import manifestModule from "../manifest.ts";
import type manifestTypes from "../manifest.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";
import nodeFs from "../platform/node/fs.ts";
import resourceEntries from "./resource-entries.ts";
import resourceFiles from "./resource-files.ts";
import resourcePatterns from "./resource-patterns.ts";

const { join, resolve } = platformModule;
const { existsSync, statSync } = nodeFs;
const { applyPatterns, hasGlobPattern, isOverridePattern, applyAutoloadDisabledPatterns } =
  resourcePatterns;
const { collectResourceFiles } = resourceEntries;
const { expandPackageGlob } = resourceFiles;
const { readMsaManifest } = manifestModule;

export default class ManifestResources {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  addManifestEntries(
    entries: string[] | undefined,
    root: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    if (entries === undefined) return;

    const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
    const patterns = entries.filter(isOverridePattern);
    const enabledPaths = applyPatterns(allFiles, patterns, root);

    for (const f of allFiles) {
      if (enabledPaths.has(f)) {
        this.manager.resources.collection.addResource(target, f, metadata, true);
      }
    }
  }

  private collectFilesFromManifestEntries(
    entries: string[],
    root: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): string[] {
    const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
    const resolved = sourceEntries.flatMap((entry) => {
      if (!hasGlobPattern(entry)) {
        return [resolve(root, entry)];
      }

      return expandPackageGlob(entry, root);
    });
    return this.collectFilesFromPaths(resolved, resourceType);
  }

  collectFilesFromPaths(
    paths: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): string[] {
    const files: string[] = [];
    for (const p of paths) {
      if (!existsSync(p)) continue;

      try {
        const stats = statSync(p);
        if (stats.isFile()) {
          files.push(p);
        } else if (stats.isDirectory()) {
          files.push(...collectResourceFiles(p, resourceType));
        }
      } catch {}
    }
    return files;
  }

  collectDefaultResources(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
    if (entries !== undefined) {
      this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
      return;
    }
    const dir = join(packageRoot, resourceType);
    if (existsSync(dir)) {
      const files = collectResourceFiles(dir, resourceType);
      for (const f of files) {
        this.manager.resources.collection.addResource(target, f, metadata, true);
      }
    }
  }

  applyPackageFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);

    if (userPatterns.length === 0) {
      for (const f of allFiles) {
        this.manager.resources.collection.addResource(target, f, metadata, false);
      }
      return;
    }

    const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);

    for (const f of allFiles) {
      const enabled = enabledByUser.has(f);
      this.manager.resources.collection.addResource(target, f, metadata, enabled);
    }
  }

  applyPackageDeltaFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    if (userPatterns.length === 0) {
      return;
    }

    const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);
    const enabledByUser = applyAutoloadDisabledPatterns(allFiles, userPatterns, packageRoot);
    for (const [filePath, enabled] of enabledByUser) {
      this.manager.resources.collection.addResource(target, filePath, metadata, enabled);
    }
  }

  private collectManifestFiles(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): { allFiles: string[]; enabledByManifest: Set<string> } {
    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
    if (entries !== undefined && entries.length > 0) {
      const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
      const manifestPatterns = entries.filter(isOverridePattern);
      const enabledByManifest =
        manifestPatterns.length > 0
          ? applyPatterns(allFiles, manifestPatterns, packageRoot)
          : new Set(allFiles);
      return { allFiles: Array.from(enabledByManifest), enabledByManifest };
    }

    const conventionDir = join(packageRoot, resourceType);
    if (!existsSync(conventionDir)) {
      return { allFiles: [], enabledByManifest: new Set() };
    }
    const allFiles = collectResourceFiles(conventionDir, resourceType);
    return { allFiles, enabledByManifest: new Set(allFiles) };
  }
}
