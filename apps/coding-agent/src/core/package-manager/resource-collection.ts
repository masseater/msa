import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import manifestModule from "../manifest.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import resolvedResourcePaths from "./resolved-resource-paths.ts";
import resourceEntries from "./resource-entries.ts";
import resourceFiles from "./resource-files.ts";
import resourcePatterns from "./resource-patterns.ts";

const { resolvedPathsOf } = resolvedResourcePaths;
const { dirname, join } = platformNode;
const { existsSync, statSync } = nodeFs;
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
  ): void {
    if (entries.length === 0) return;

    const { plain, patterns } = splitPatterns(entries);
    const resolvedPlain = plain.map((p) => this.manager.sources.resolvePathFromBase(p, baseDir));
    const allFiles = this.manager.resources.manifest.collectFilesFromPaths(
      resolvedPlain,
      resourceType,
    );

    const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

    for (const f of allFiles) {
      this.addResource(target, f, metadata, enabledPaths.has(f));
    }
  }

  toResolvedPaths(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
  ): packageManagerTypes.ResolvedPaths {
    return resolvedPathsOf(accumulator);
  }

  resolveLocalExtensionSource(
    source: defaultPackageManagerInternalTypes.LocalSource,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
    baseDir: string,
  ): void {
    const resolved = this.manager.sources.resolvePathFromBase(source.path, baseDir);
    if (!existsSync(resolved)) {
      return;
    }

    try {
      const stats = statSync(resolved);
      if (stats.isFile()) {
        metadata.baseDir = dirname(resolved);
        this.addResource(accumulator.extensions, resolved, metadata, true);
        return;
      }
      if (stats.isDirectory()) {
        metadata.baseDir = resolved;
        metadata.packageRoot = resolved;
        const resources = this.collectPackageResources(resolved, accumulator, filter, metadata);
        if (!resources) {
          this.addResource(accumulator.extensions, resolved, metadata, true);
        }
      }
    } catch {
      return undefined;
    }
  }

  collectPackageResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter | undefined,
    metadata: packageManagerTypes.PathMetadata,
  ): boolean {
    if (filter !== undefined) {
      this.collectFilteredResources(packageRoot, accumulator, filter, metadata);
      return true;
    }
    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    if (manifest !== null) {
      for (const resourceType of RESOURCE_TYPES) {
        this.manager.resources.manifest.addManifestEntries(
          manifest[resourceType as keyof typeof manifest],
          packageRoot,
          resourceType,
          this.getTargetMap(accumulator, resourceType),
          metadata,
        );
      }
      return true;
    }
    return this.collectConventionalResources(packageRoot, accumulator, metadata);
  }

  private collectFilteredResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    filter: defaultPackageManagerInternalTypes.PackageFilter,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    const { manifest } = this.manager.resources;
    for (const resourceType of RESOURCE_TYPES) {
      const patterns = filter[resourceType];
      const target = this.getTargetMap(accumulator, resourceType);
      if (filter.autoload === false) {
        manifest.applyPackageDeltaFilter(
          packageRoot,
          patterns ?? [],
          resourceType,
          target,
          metadata,
        );
      } else if (patterns === undefined) {
        manifest.collectDefaultResources(packageRoot, resourceType, target, metadata);
      } else {
        manifest.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
      }
    }
  }

  private collectConventionalResources(
    packageRoot: string,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    metadata: packageManagerTypes.PathMetadata,
  ): boolean {
    let hasAnyDir = false;
    for (const resourceType of RESOURCE_TYPES) {
      const dir = join(packageRoot, resourceType);
      if (!existsSync(dir)) continue;
      for (const f of collectResourceFiles(dir, resourceType)) {
        this.addResource(this.getTargetMap(accumulator, resourceType), f, metadata, true);
      }
      hasAnyDir = true;
    }
    return hasAnyDir;
  }

  resolveTopLevelEntries(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    scopes: Array<{
      baseDir: string;
      scope: "project" | "user";
      settings: Partial<Record<defaultPackageManagerInternalTypes.ResourceType, unknown>>;
    }>,
  ): void {
    for (const resourceType of RESOURCE_TYPES) {
      const target = this.getTargetMap(accumulator, resourceType);
      for (const { baseDir, scope, settings } of scopes) {
        const entries = (settings[resourceType] ?? []) as string[];
        this.resolveLocalEntries(
          entries,
          resourceType,
          target,
          { origin: "top-level", scope, source: "local" },
          baseDir,
        );
      }
    }
  }
}
