import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type ResourceEnvironment from "./resource-environment.ts";

const { existsSync, statSync } = nodeFs;
const { join, resolve, sep } = platformNode;
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
  ): string {
    if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
      return resource.path;
    }
    try {
      const stats = statSync(resource.path);
      if (!stats.isDirectory()) {
        return resource.path;
      }
    } catch {
      return resource.path;
    }
    const skillFile = join(resource.path, "SKILL.md");
    if (existsSync(skillFile)) {
      if (!metadataByPath.has(skillFile)) {
        metadataByPath.set(skillFile, resource.metadata);
      }
      return skillFile;
    }
    return resource.path;
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
      return this.getDefaultSourceInfoForPath(resourcePath);
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

  getDefaultSourceInfoForPath(filePath: string): sourceInfoTypes.SourceInfo {
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

    return {
      baseDir: statSync(normalizedPath).isDirectory()
        ? normalizedPath
        : resolve(normalizedPath, ".."),
      origin: "top-level",
      path: filePath,
      scope: "temporary",
      source: "local",
    };
  }

  mergePaths(primary: string[], additional: string[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const p of [...primary, ...additional]) {
      const resolved = this.resolveResourcePath(p);
      const canonicalPath = canonicalizePath(resolved);
      if (seen.has(canonicalPath)) continue;
      seen.add(canonicalPath);
      merged.push(resolved);
    }

    return merged;
  }

  resolveResourcePath(p: string): string {
    return isSyntheticPath(p) ? p : resolvePath(p, this.owner.cwd, { trim: true });
  }

  missingPaths(paths: string[], localOnly: boolean): string[] {
    return paths
      .filter((p) => !localOnly || isLocalPath(p))
      .map((p) => this.resolveResourcePath(p))
      .filter((resolved) => !existsSync(resolved));
  }
}
