import config from "../../config.ts";
import pathsModule from "../../utils/paths.ts";
import text from "../../utils/text.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import packageManager from "../package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";

const { markPathIgnoredByCloudSync } = pathsModule;
const { join } = platformModule;
const { exists, makeDirectory, readText, writeFile } = platformModule.files;
const { ensureExtensionTempFolder } = packageManager;
const { stripBom } = text;
const { CONFIG_DIR_NAME } = config;

export default class NpmPaths {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getInstalledNpmVersion(installedPath: string): Promise<string | undefined> {
    return readText(join(installedPath, "package.json")).then(
      (content) => (JSON.parse(stripBom(content)) as { version?: string }).version,
      () => undefined,
    );
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

  ensureNpmProject(installRoot: string, temporary: boolean): Promise<void> {
    const packageJsonPath = join(installRoot, "package.json");
    return (temporary ? ensureExtensionTempFolder(this.manager.agentDir) : Promise.resolve())
      .then(() => makeDirectory({ path: installRoot }))
      .then(() => {
        markPathIgnoredByCloudSync(installRoot);
        return this.manager.git.paths.ensureGitIgnore(installRoot);
      })
      .then(() => exists(packageJsonPath))
      .then((found) =>
        found
          ? undefined
          : writeFile({
              data: JSON.stringify({ name: "msa-extensions", private: true }, null, 2),
              path: packageJsonPath,
            }),
      );
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
  ): Promise<string> {
    const managedPath = this.getManagedNpmInstallPath(source, scope);
    if (scope !== "user") return Promise.resolve(managedPath);
    return exists(managedPath).then((found) => {
      if (found) return managedPath;
      const legacyPath = this.getLegacyGlobalNpmInstallPath(source);
      return legacyPath === undefined || legacyPath === ""
        ? managedPath
        : exists(legacyPath).then((legacyFound) => (legacyFound ? legacyPath : managedPath));
    });
  }
}
