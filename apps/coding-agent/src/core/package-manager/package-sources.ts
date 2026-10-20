import config from "../../config.ts";
import git from "../../utils/git.ts";
import pathsModule from "../../utils/paths.ts";
import defaultPackageManagerHelpers from "../default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import packageManager from "../package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";

const { resolvePath, isLocalPath } = pathsModule;
const { join, resolve, sep, sha256Hex, relative } = platformNode;
const { CONFIG_DIR_NAME } = config;
const { getExtensionTempFolder } = packageManager;
const { getHomeDir, getNpmVersionRange, isExactNpmVersion } = defaultPackageManagerHelpers;
const { parseGitUrl } = git;

export default class PackageSources {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getPackageSourceString(pkg: settingsManagerTypes.PackageSource): string {
    return typeof pkg === "string" ? pkg : pkg.source;
  }

  assertProjectTrustedForScope(scope: packageManagerTypes.SourceScope): void {
    if (scope === "project" && !this.manager.settingsManager.isProjectTrusted()) {
      throw new Error("Project is not trusted; refusing to access project package storage");
    }
  }

  getTemporaryDir(prefix: string, suffix?: string, ref?: string): string {
    const root = this.resolveManagedPath(getExtensionTempFolder(this.manager.agentDir), prefix);
    const hash = sha256Hex(
      `${prefix}-${suffix ?? ""}${ref !== undefined && ref !== "" ? `@${ref}` : ""}`,
    ).slice(0, 8);
    return this.resolveManagedPath(root, hash, suffix ?? "");
  }

  resolveManagedPath(root: string, ...parts: string[]): string {
    const resolvedRoot = resolve(root);
    const resolvedPath = resolve(resolvedRoot, ...parts);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`Refusing to use path outside package install root: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  getBaseDirForScope(scope: packageManagerTypes.SourceScope): string {
    if (scope === "project") {
      this.assertProjectTrustedForScope(scope);
      return join(this.manager.cwd, CONFIG_DIR_NAME);
    }
    if (scope === "user") {
      return this.manager.agentDir;
    }
    return this.manager.cwd;
  }

  resolvePath(input: string): string {
    return resolvePath(input, this.manager.cwd, { homeDir: getHomeDir(), trim: true });
  }

  resolvePathFromBase(input: string, baseDir: string): string {
    return resolvePath(input, baseDir, { homeDir: getHomeDir(), trim: true });
  }

  private getSourceMatchKeyForInput(source: string): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    return `local:${this.resolvePath(parsed.path)}`;
  }

  private getSourceMatchKeyForSettings(
    source: string,
    scope: packageManagerTypes.SourceScope,
  ): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    const baseDir = this.getBaseDirForScope(scope);
    return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
  }

  parseSource(source: string): defaultPackageManagerInternalTypes.ParsedSource {
    if (source.startsWith("npm:")) {
      const spec = source.slice("npm:".length).trim();
      const { name, version } = this.manager.npm.paths.parseNpmSpec(spec);
      return {
        name,
        pinned: isExactNpmVersion(version),
        range: getNpmVersionRange(version),
        spec,
        type: "npm",
        version,
      };
    }

    if (isLocalPath(source)) {
      return { path: source, type: "local" };
    }

    const gitParsed = parseGitUrl(source);
    if (gitParsed !== null) {
      return gitParsed;
    }

    return { path: source, type: "local" };
  }

  getPackageIdentity(source: string, scope?: packageManagerTypes.SourceScope): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    if (scope !== undefined) {
      const baseDir = this.getBaseDirForScope(scope);
      return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
    }
    return `local:${this.resolvePath(parsed.path)}`;
  }

  packageSourcesMatch(
    existing: settingsManagerTypes.PackageSource,
    inputSource: string,
    scope: packageManagerTypes.SourceScope,
  ): boolean {
    const left = this.getSourceMatchKeyForSettings(this.getPackageSourceString(existing), scope);
    const right = this.getSourceMatchKeyForInput(inputSource);
    return left === right;
  }

  normalizePackageSourceForSettings(
    source: string,
    scope: packageManagerTypes.SourceScope,
  ): string {
    const parsed = this.parseSource(source);
    if (parsed.type !== "local") {
      return source;
    }
    const baseDir = this.getBaseDirForScope(scope);
    const resolved = this.resolvePath(parsed.path);
    const rel = relative(baseDir, resolved);
    return rel || ".";
  }
}
