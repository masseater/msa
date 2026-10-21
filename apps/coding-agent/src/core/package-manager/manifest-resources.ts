import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import manifestModule from "../manifest.ts";
import type manifestTypes from "../manifest.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";
import resourceEntries from "./resource-entries.ts";
import resourceFiles from "./resource-files.ts";
import resourcePatterns from "./resource-patterns.ts";

const { join, resolve } = platformModule;
const { exists, stat } = platformModule.files;
const { awaited, promised } = awaitingModule;
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
  ): Promise<void> {
    if (entries === undefined) return Promise.resolve();
    return this.collectFilesFromManifestEntries(entries, root, resourceType).then((allFiles) => {
      const patterns = entries.filter(isOverridePattern);
      const enabledPaths = applyPatterns(allFiles, patterns, root);
      for (const f of allFiles) {
        if (enabledPaths.has(f)) {
          this.manager.resources.collection.addResource(target, f, metadata, true);
        }
      }
      return undefined;
    });
  }

  private collectFilesFromManifestEntries(
    entries: string[],
    root: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): Promise<string[]> {
    const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
    return Promise.all(
      sourceEntries.map((entry) =>
        hasGlobPattern(entry) ? expandPackageGlob(entry, root) : [resolve(root, entry)],
      ),
    ).then((resolved) => this.collectFilesFromPaths(resolved.flat(), resourceType));
  }

  collectFilesFromPaths(
    paths: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): Promise<string[]> {
    return promised(function* () {
      const files: string[] = [];
      for (const p of paths) {
        if (!(yield* awaited(exists(p)))) continue;
        try {
          const stats = yield* awaited(stat(p));
          if (stats.isFile) {
            files.push(p);
          } else if (stats.isDirectory) {
            files.push(...(yield* awaited(collectResourceFiles(p, resourceType))));
          }
        } catch {}
      }
      return files;
    });
  }

  collectDefaultResources(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<void> {
    const manager = this.manager;
    const addManifestEntries = this.addManifestEntries.bind(this);
    return promised(function* () {
      const manifest = yield* awaited(readMsaManifest(join(packageRoot, "package.json")));
      const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
      if (entries !== undefined) {
        yield* awaited(addManifestEntries(entries, packageRoot, resourceType, target, metadata));
        return;
      }
      const dir = join(packageRoot, resourceType);
      if (!(yield* awaited(exists(dir)))) return;
      for (const f of yield* awaited(collectResourceFiles(dir, resourceType))) {
        manager.resources.collection.addResource(target, f, metadata, true);
      }
    });
  }

  applyPackageFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<void> {
    return this.collectManifestFiles(packageRoot, resourceType).then(({ allFiles }) => {
      const enabledByUser =
        userPatterns.length === 0
          ? new Set<string>()
          : applyPatterns(allFiles, userPatterns, packageRoot);
      for (const f of allFiles) {
        this.manager.resources.collection.addResource(target, f, metadata, enabledByUser.has(f));
      }
      return undefined;
    });
  }

  applyPackageDeltaFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<void> {
    if (userPatterns.length === 0) {
      return Promise.resolve();
    }
    return this.collectManifestFiles(packageRoot, resourceType).then(({ allFiles }) => {
      const enabledByUser = applyAutoloadDisabledPatterns(allFiles, userPatterns, packageRoot);
      for (const [filePath, enabled] of enabledByUser) {
        this.manager.resources.collection.addResource(target, filePath, metadata, enabled);
      }
      return undefined;
    });
  }

  private collectManifestFiles(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): Promise<{ allFiles: string[]; enabledByManifest: Set<string> }> {
    const collectFromEntries = this.collectFilesFromManifestEntries.bind(this);
    return promised(function* () {
      const manifest = yield* awaited(readMsaManifest(join(packageRoot, "package.json")));
      const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
      if (entries !== undefined && entries.length > 0) {
        const allFiles = yield* awaited(collectFromEntries(entries, packageRoot, resourceType));
        const manifestPatterns = entries.filter(isOverridePattern);
        const enabledByManifest =
          manifestPatterns.length > 0
            ? applyPatterns(allFiles, manifestPatterns, packageRoot)
            : new Set(allFiles);
        return { allFiles: Array.from(enabledByManifest), enabledByManifest };
      }

      const conventionDir = join(packageRoot, resourceType);
      if (!(yield* awaited(exists(conventionDir)))) {
        return { allFiles: [], enabledByManifest: new Set<string>() };
      }
      const allFiles = yield* awaited(collectResourceFiles(conventionDir, resourceType));
      return { allFiles, enabledByManifest: new Set(allFiles) };
    });
  }
}
