import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import text from "../../utils/text.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";

const { markPathIgnoredByCloudSync } = pathsModule;
const { join } = platformNode;
const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { stripBom } = text;
const { CONFIG_DIR_NAME } = config;

export default class NpmPaths {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getInstalledNpmVersion(installedPath: string): string | undefined {
    const packageJsonPath = join(installedPath, "package.json");
    if (!existsSync(packageJsonPath)) return undefined;
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const pkg = JSON.parse(stripBom(content)) as { version?: string };
      return pkg.version;
    } catch {
      return undefined;
    }
  }

  parseNpmSpec(spec: string): { name: string; version?: string } {
    const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/u);
    if (match === null) {
      return { name: spec };
    }
    const name = match[1] ?? spec;
    const version = match[2];
    return version === undefined ? { name } : { name, version };
  }

  getNpmInstallRoot(scope: packageManagerTypes.SourceScope, temporary: boolean): string {
    if (temporary) {
      return this.manager.sources.getTemporaryDir("npm");
    }
    if (scope === "project") {
      this.manager.sources.assertProjectTrustedForScope(scope);
      return join(this.manager.cwd, CONFIG_DIR_NAME, "npm");
    }
    return join(this.manager.agentDir, "npm");
  }

  getManagedNpmInstallPath(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
  ): string {
    if (scope === "temporary") {
      return join(this.manager.sources.getTemporaryDir("npm"), "node_modules", source.name);
    }
    if (scope === "project") {
      this.manager.sources.assertProjectTrustedForScope(scope);
      return join(this.manager.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
    }
    return join(this.manager.agentDir, "npm", "node_modules", source.name);
  }

  ensureNpmProject(installRoot: string): void {
    if (!existsSync(installRoot)) {
      mkdirSync(installRoot, { recursive: true });
    }
    markPathIgnoredByCloudSync(installRoot);
    this.manager.git.paths.ensureGitIgnore(installRoot);
    const packageJsonPath = join(installRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      const pkgJson = { name: "msa-extensions", private: true };
      writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
    }
  }

  private getLegacyGlobalNpmInstallPath(
    source: defaultPackageManagerInternalTypes.NpmSource,
  ): string | undefined {
    try {
      return (
        this.manager.npm.tool.getPnpmGlobalPackagePath(source.name) ??
        join(this.manager.npm.tool.getGlobalNpmRoot(), source.name)
      );
    } catch {
      return undefined;
    }
  }

  getNpmInstallPath(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
  ): string {
    const managedPath = this.getManagedNpmInstallPath(source, scope);
    if (scope !== "user" || existsSync(managedPath)) {
      return managedPath;
    }
    const legacyPath = this.getLegacyGlobalNpmInstallPath(source);
    return legacyPath !== undefined && legacyPath !== "" && existsSync(legacyPath)
      ? legacyPath
      : managedPath;
  }
}
