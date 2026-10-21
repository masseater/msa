import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type ResourceEnvironment from "./resource-environment.ts";

const { join, resolve, sep } = platformModule;
const { exists, stat } = platformModule.files;
const { CONFIG_DIR_NAME } = config;
const { createSourceInfo, getSyntheticPathSource, isSyntheticPath } = sourceInfoModule;
const { canonicalizePath, isLocalPath, resolvePath } = pathsModule;

export default class ResourcePaths {
  private readonly owner: ResourceEnvironment;

  constructor(owner: ResourceEnvironment) {
    this.owner = owner;
  }

  resourceMetadataByPath = new Map<string, packageManagerTypes.PathMetadata>();

  mapSkillPath(
    resource: packageManagerTypes.ResolvedResource,
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
  ): Promise<string> {
    if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
      return Promise.resolve(resource.path);
    }
    const skillFile = join(resource.path, "SKILL.md");
    return stat(resource.path)
      .then((info) => info.isDirectory && exists(skillFile))
      .then(
        (hasSkillFile) => {
          if (!hasSkillFile) return resource.path;
          if (!metadataByPath.has(skillFile)) metadataByPath.set(skillFile, resource.metadata);
          return skillFile;
        },
        () => resource.path,
      );
  }

  private resourceRoots(filePath: string) {
    const normalizedPath = resolve(filePath);
    const agentRoots = [
      join(this.owner.agentDir, "skills"),
      join(this.owner.agentDir, "prompts"),
      join(this.owner.agentDir, "themes"),
      join(this.owner.agentDir, "extensions"),
    ];
    const projectRoots = [
      join(this.owner.cwd, CONFIG_DIR_NAME, "skills"),
      join(this.owner.cwd, CONFIG_DIR_NAME, "prompts"),
      join(this.owner.cwd, CONFIG_DIR_NAME, "themes"),
      join(this.owner.cwd, CONFIG_DIR_NAME, "extensions"),
    ];
    return { agentRoots, normalizedPath, projectRoots };
  }

  private isUnderPath(target: string, root: string): boolean {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  }

  findSourceInfoForPath(
    resourcePath: string,
    extraSourceInfos?: Map<string, sourceInfoTypes.SourceInfo>,
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): sourceInfoTypes.SourceInfo | undefined {
    if (resourcePath === "") {
      return undefined;
    }

    if (isSyntheticPath(resourcePath)) {
      return this.rootedSourceInfo(resourcePath);
    }

    const normalizedResourcePath = resolve(resourcePath);
    if (extraSourceInfos !== undefined) {
      for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
        const normalizedSourcePath = resolve(sourcePath);
        if (
          normalizedResourcePath === normalizedSourcePath ||
          normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
        ) {
          return { ...sourceInfo, path: resourcePath };
        }
      }
    }

    if (metadataByPath !== undefined) {
      const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
      if (exact !== undefined) {
        return createSourceInfo(resourcePath, exact);
      }

      for (const [sourcePath, metadata] of metadataByPath.entries()) {
        const normalizedSourcePath = resolve(sourcePath);
        if (
          normalizedResourcePath === normalizedSourcePath ||
          normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
        ) {
          return createSourceInfo(resourcePath, metadata);
        }
      }
    }

    return undefined;
  }

  getDefaultSourceInfoForPath(filePath: string): Promise<sourceInfoTypes.SourceInfo> {
    const known = this.rootedSourceInfo(filePath);
    if (known !== undefined) return Promise.resolve(known);
    const normalizedPath = resolve(filePath);
    return stat(normalizedPath).then((info) => ({
      baseDir: info.isDirectory ? normalizedPath : resolve(normalizedPath, ".."),
      origin: "top-level" as const,
      path: filePath,
      scope: "temporary" as const,
      source: "local",
    }));
  }

  private rootedSourceInfo(filePath: string): sourceInfoTypes.SourceInfo | undefined {
    const syntheticSource = getSyntheticPathSource(filePath);
    if (syntheticSource !== undefined && syntheticSource !== "") {
      return {
        origin: "top-level",
        path: filePath,
        scope: "temporary",
        source: syntheticSource,
      };
    }

    const { agentRoots, normalizedPath, projectRoots } = this.resourceRoots(filePath);

    for (const root of agentRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          baseDir: root,
          origin: "top-level",
          path: filePath,
          scope: "user",
          source: "local",
        };
      }
    }

    for (const root of projectRoots) {
      if (this.isUnderPath(normalizedPath, root)) {
        return {
          baseDir: root,
          origin: "top-level",
          path: filePath,
          scope: "project",
          source: "local",
        };
      }
    }

    return undefined;
  }

  mergePaths(primary: string[], additional: string[]): Promise<string[]> {
    const resolvedPaths = [...primary, ...additional].map((p) => this.resolveResourcePath(p));
    return Promise.all(resolvedPaths.map((resolved) => canonicalizePath(resolved))).then(
      (canonicalPaths) => {
        const seen = new Set<string>();
        return resolvedPaths.filter((_resolved, index) => {
          const canonicalPath = canonicalPaths[index]!;
          if (seen.has(canonicalPath)) return false;
          seen.add(canonicalPath);
          return true;
        });
      },
    );
  }

  resolveResourcePath(p: string): string {
    return isSyntheticPath(p) ? p : resolvePath(p, this.owner.cwd, { trim: true });
  }

  missingPaths(paths: string[], localOnly: boolean): Promise<string[]> {
    const candidates = paths
      .filter((p) => !localOnly || isLocalPath(p))
      .map((p) => this.resolveResourcePath(p));
    return Promise.all(candidates.map((resolved) => exists(resolved))).then((found) =>
      candidates.filter((_resolved, index) => found[index] !== true),
    );
  }
}
