import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import manifestModule from "../manifest.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";
import resolvedResourcePaths from "./resolved-resource-paths.ts";
import resourceEntries from "./resource-entries.ts";
import resourceFiles from "./resource-files.ts";
import resourcePatterns from "./resource-patterns.ts";

const { resolvedPathsOf } = resolvedResourcePaths;
const { dirname, join } = platformModule;
const { exists, stat } = platformModule.files;
const { awaited, promised } = awaitingModule;
const { applyPatterns, splitPatterns } = resourcePatterns;
const { collectResourceFiles } = resourceEntries;
const { RESOURCE_TYPES } = resourceFiles;
const { readMsaManifest } = manifestModule;

export default class ResourceCollection {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getTargetMap(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }> {
    switch (resourceType) {
      case "extensions":
        return accumulator.extensions;
      case "skills":
        return accumulator.skills;
      case "prompts":
        return accumulator.prompts;
      case "themes":
        return accumulator.themes;
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
  }

  addResource(
    map: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    path: string,
    metadata: packageManagerTypes.PathMetadata,
    enabled: boolean,
  ): void {
    if (path === "") return;
    if (!map.has(path)) {
      map.set(path, { enabled, metadata });
    }
  }

  createAccumulator(): defaultPackageManagerInternalTypes.ResourceAccumulator {
    return {
      extensions: new Map(),
      prompts: new Map(),
      skills: new Map(),
      themes: new Map(),
    };
  }

  resolveLocalEntries(
    entries: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
    baseDir: string,
  ): Promise<void> {
    if (entries.length === 0) return Promise.resolve();

    const { plain, patterns } = splitPatterns(entries);
    const resolvedPlain = plain.map((p) => this.manager.sources.resolvePathFromBase(p, baseDir));
    return this.manager.resources.manifest
      .collectFilesFromPaths(resolvedPlain, resourceType)
      .then((allFiles) => {
        const enabledPaths = applyPatterns(allFiles, patterns, baseDir);
        for (const f of allFiles) {
          this.addResource(target, f, metadata, enabledPaths.has(f));
        }
        return undefined;
      });
  }

  toResolvedPaths(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
  ): Promise<packageManagerTypes.ResolvedPaths> {
    return resolvedPathsOf(accumulator);
  }

  resolveLocalExtensionSource(
    source: defaultPackageManagerInternalTypes.LocalSource,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
    baseDir: string,
  ): Promise<void> {
    const resolved = this.manager.sources.resolvePathFromBase(source.path, baseDir);
    const collection = this;
    return promised(function* () {
      if (!(yield* awaited(exists(resolved)))) return;
      try {
        const stats = yield* awaited(stat(resolved));
        if (stats.isFile) {
          metadata.baseDir = dirname(resolved);
          collection.addResource(accumulator.extensions, resolved, metadata, true);
          return;
        }
        if (stats.isDirectory) {
          metadata.baseDir = resolved;
          metadata.packageRoot = resolved;
          const resources = yield* awaited(
            collection.collectPackageResources(resolved, accumulator, filter, metadata),
          );
          if (!resources) collection.addResource(accumulator.extensions, resolved, metadata, true);
        }
      } catch {}
    });
  }

  collectPackageResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<boolean> {
    if (filter !== undefined) {
      return this.collectFilteredResources(packageRoot, accumulator, filter, metadata).then(
        () => true,
      );
    }
    const collection = this;
    return promised(function* () {
      const manifest = yield* awaited(readMsaManifest(join(packageRoot, "package.json")));
      if (manifest === null)
        return yield* awaited(
          collection.collectConventionalResources(packageRoot, accumulator, metadata),
        );
      for (const resourceType of RESOURCE_TYPES) {
        yield* awaited(
          collection.manager.resources.manifest.addManifestEntries(
            manifest[resourceType as keyof typeof manifest],
            packageRoot,
            resourceType,
            collection.getTargetMap(accumulator, resourceType),
            metadata,
          ),
        );
      }
      return true;
    });
  }

  private collectFilteredResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<void> {
    const { manifest } = this.manager.resources;
    const collection = this;
    return promised(function* () {
      for (const resourceType of RESOURCE_TYPES) {
        const patterns = filter[resourceType];
        const target = collection.getTargetMap(accumulator, resourceType);
        if (filter.autoload === false) {
          yield* awaited(
            manifest.applyPackageDeltaFilter(
              packageRoot,
              patterns ?? [],
              resourceType,
              target,
              metadata,
            ),
          );
        } else if (patterns === undefined) {
          yield* awaited(
            manifest.collectDefaultResources(packageRoot, resourceType, target, metadata),
          );
        } else {
          yield* awaited(
            manifest.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata),
          );
        }
      }
    });
  }

  private collectConventionalResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    metadata: packageManagerTypes.PathMetadata,
  ): Promise<boolean> {
    const collection = this;
    return promised(function* () {
      let hasAnyDir = false;
      for (const resourceType of RESOURCE_TYPES) {
        const dir = join(packageRoot, resourceType);
        if (!(yield* awaited(exists(dir)))) continue;
        for (const f of yield* awaited(collectResourceFiles(dir, resourceType))) {
          collection.addResource(
            collection.getTargetMap(accumulator, resourceType),
            f,
            metadata,
            true,
          );
        }
        hasAnyDir = true;
      }
      return hasAnyDir;
    });
  }

  resolveTopLevelEntries(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    scopes: Array<{
      baseDir: string;
      scope: "project" | "user";
      settings: Partial<Record<defaultPackageManagerInternalTypes.ResourceType, unknown>>;
    }>,
  ): Promise<void> {
    const collection = this;
    return promised(function* () {
      for (const resourceType of RESOURCE_TYPES) {
        const target = collection.getTargetMap(accumulator, resourceType);
        for (const { baseDir, scope, settings } of scopes) {
          const entries = (settings[resourceType] ?? []) as string[];
          yield* awaited(
            collection.resolveLocalEntries(
              entries,
              resourceType,
              target,
              { origin: "top-level", scope, source: "local" },
              baseDir,
            ),
          );
        }
      }
    });
  }
}
