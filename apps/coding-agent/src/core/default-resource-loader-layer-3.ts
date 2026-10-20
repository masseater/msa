import pathsModule from "../utils/paths.ts";
import DefaultResourceLoaderLayer2 from "./default-resource-loader-layer-2.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import sourceInfoModule from "./source-info.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { createSourceInfo, getSyntheticPathSource, isSyntheticPath } = sourceInfoModule;
const { canonicalizePath, resolvePath } = pathsModule;
const { resolve, sep } = platformNode;
const { statSync } = nodeFs;

export default abstract class DefaultResourceLoaderLayer3 extends DefaultResourceLoaderLayer2 {
  protected resolveExtensionLoadPath(path: string): string {
    return isSyntheticPath(path)
      ? path
      : resolvePath(path, this.cwd, { normalizeUnicodeSpaces: true });
  }

  protected normalizeExtensionPaths(
    entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>,
  ): Array<{ path: string; metadata: packageManagerTypes.PathMetadata }> {
    return entries.map((entry) => {
      const metadata =
        entry.metadata.baseDir !== undefined && entry.metadata.baseDir !== ""
          ? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
          : entry.metadata;
      return {
        metadata,
        path: this.resolveResourcePath(entry.path),
      };
    });
  }

  protected applyExtensionSourceInfo(
    extensions: extensionsTypesTypes.Extension[],
    metadataByPath: Map<string, packageManagerTypes.PathMetadata>,
  ): void {
    for (const extension of extensions) {
      extension.sourceInfo =
        this.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
        this.getDefaultSourceInfoForPath(extension.path);
      for (const command of extension.commands.values()) {
        command.sourceInfo = extension.sourceInfo;
      }
      for (const tool of extension.tools.values()) {
        tool.sourceInfo = extension.sourceInfo;
      }
    }
  }

  protected findSourceInfoForPath(
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

  protected getDefaultSourceInfoForPath(filePath: string): sourceInfoTypes.SourceInfo {
    const syntheticSource = getSyntheticPathSource(filePath);
    if (syntheticSource !== undefined && syntheticSource !== "") {
      return {
        origin: "top-level",
        path: filePath,
        scope: "temporary",
        source: syntheticSource,
      };
    }

    const { agentRoots, normalizedPath, projectRoots } =
      this.getDefaultSourceInfoForPathPart1(filePath);

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

  protected mergePaths(primary: string[], additional: string[]): string[] {
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

  protected resolveResourcePath(p: string): string {
    return isSyntheticPath(p) ? p : resolvePath(p, this.cwd, { trim: true });
  }
}
