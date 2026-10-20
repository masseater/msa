import childProcess from "../utils/child-process.ts";
import text from "../utils/text.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import DefaultPackageManagerLayer3 from "./default-package-manager-layer-3.ts";
import outputGuard from "./output-guard.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import type nodeChildProcessTypes from "./platform/node/child-process.types.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { existsSync, readFileSync } = nodeFs;
const { join, relative, resolve, sep } = platformNode;
const { stripBom } = text;
const { spawnProcess } = childProcess;
const { isStdoutTakenOver } = outputGuard;
const { getEnv } = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer4 extends DefaultPackageManagerLayer3 {
  addSourceToSettings(source: string, options?: { local?: boolean }): boolean {
    const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
    const currentSettings =
      scope === "project"
        ? this.settingsManager.getProjectSettings()
        : this.settingsManager.getGlobalSettings();
    const currentPackages = currentSettings.packages ?? [];
    const normalizedSource = this.normalizePackageSourceForSettings(source, scope);
    const matchIndex = currentPackages.findIndex((existing) =>
      this.packageSourcesMatch(existing, source, scope),
    );
    const existing = currentPackages[matchIndex];
    if (existing !== undefined) {
      if (this.getPackageSourceString(existing) === normalizedSource) {
        return false;
      }
      const nextPackages = [...currentPackages];
      nextPackages[matchIndex] =
        typeof existing === "string" ? normalizedSource : { ...existing, source: normalizedSource };
      if (scope === "project") {
        this.settingsManager.setProjectPackages(nextPackages);
      } else {
        this.settingsManager.setPackages(nextPackages);
      }
      return true;
    }
    const nextPackages = [...currentPackages, normalizedSource];
    if (scope === "project") {
      this.settingsManager.setProjectPackages(nextPackages);
    } else {
      this.settingsManager.setPackages(nextPackages);
    }
    return true;
  }

  removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean {
    const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
    const currentSettings =
      scope === "project"
        ? this.settingsManager.getProjectSettings()
        : this.settingsManager.getGlobalSettings();
    const currentPackages = currentSettings.packages ?? [];
    const nextPackages = currentPackages.filter(
      (existing) => !this.packageSourcesMatch(existing, source, scope),
    );
    const changed = nextPackages.length !== currentPackages.length;
    if (!changed) {
      return false;
    }
    if (scope === "project") {
      this.settingsManager.setProjectPackages(nextPackages);
    } else {
      this.settingsManager.setPackages(nextPackages);
    }
    return true;
  }

  getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      const path = this.getNpmInstallPath(parsed, scope);
      return existsSync(path) ? path : undefined;
    }
    if (parsed.type === "git") {
      const path = this.getGitInstallPath(parsed, scope);
      return existsSync(path) ? path : undefined;
    }
    if (parsed.type === "local") {
      const baseDir = this.getBaseDirForScope(scope);
      const path = this.resolvePathFromBase(parsed.path, baseDir);
      return existsSync(path) ? path : undefined;
    }
    return undefined;
  }

  listConfiguredPackages(): packageManagerTypes.ConfiguredPackage[] {
    const globalSettings = this.settingsManager.getGlobalSettings();
    const projectSettings = this.settingsManager.getProjectSettings();
    const configuredPackages: packageManagerTypes.ConfiguredPackage[] = [];

    for (const pkg of globalSettings.packages ?? []) {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      configuredPackages.push({
        filtered: typeof pkg === "object",
        installedPath: this.getInstalledPath(source, "user"),
        scope: "user",
        source,
      });
    }

    for (const pkg of projectSettings.packages ?? []) {
      const source = typeof pkg === "string" ? pkg : pkg.source;
      configuredPackages.push({
        filtered: typeof pkg === "object",
        installedPath: this.getInstalledPath(source, "project"),
        scope: "project",
        source,
      });
    }

    return configuredPackages;
  }

  protected findAutoloadDeltaBase(
    pkg: settingsManagerTypes.PackageSource,
    scope: packageManagerTypes.SourceScope,
    sources: Array<{
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }>,
  ): { source: string; scope: packageManagerTypes.SourceScope } | undefined {
    if (scope !== "project" || typeof pkg !== "object" || pkg.autoload !== false) return undefined;
    const identity = this.getPackageIdentity(pkg.source, scope);
    const userEntry = sources.find(
      (entry) =>
        entry.scope === "user" &&
        this.getPackageIdentity(this.getPackageSourceString(entry.pkg), "user") === identity,
    );
    return userEntry === undefined
      ? undefined
      : { scope: "user", source: this.getPackageSourceString(userEntry.pkg) };
  }

  protected buildNoMatchingPackageMessage(
    source: string,
    configuredPackages: settingsManagerTypes.PackageSource[],
  ): string {
    const suggestion = this.findSuggestedConfiguredSource(source, configuredPackages);
    if (suggestion === undefined || suggestion === "") {
      return `No matching package found for ${source}`;
    }
    return `No matching package found for ${source}. Did you mean ${suggestion}?`;
  }

  protected findSuggestedConfiguredSource(
    source: string,
    configuredPackages: settingsManagerTypes.PackageSource[],
  ): string | undefined {
    const trimmedSource = source.trim();
    const suggestions = new Set<string>();

    for (const pkg of configuredPackages) {
      const sourceStr = this.getPackageSourceString(pkg);
      const parsed = this.parseSource(sourceStr);
      if (parsed.type === "npm") {
        if (trimmedSource === parsed.name || trimmedSource === parsed.spec) {
          suggestions.add(sourceStr);
        }
        continue;
      }
      if (parsed.type === "git") {
        const shorthand = `${parsed.host}/${parsed.path}`;
        const shorthandWithRef =
          parsed.ref !== undefined && parsed.ref !== "" ? `${shorthand}@${parsed.ref}` : undefined;
        if (
          trimmedSource === shorthand ||
          (shorthandWithRef && trimmedSource === shorthandWithRef) === true
        ) {
          suggestions.add(sourceStr);
        }
      }
    }

    return suggestions.values().next().value;
  }

  protected packageSourcesMatch(
    existing: settingsManagerTypes.PackageSource,
    inputSource: string,
    scope: packageManagerTypes.SourceScope,
  ): boolean {
    const left = this.getSourceMatchKeyForSettings(this.getPackageSourceString(existing), scope);
    const right = this.getSourceMatchKeyForInput(inputSource);
    return left === right;
  }

  protected normalizePackageSourceForSettings(
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

  protected dedupePackages(
    packages: Array<{
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }>,
  ): Array<{ pkg: settingsManagerTypes.PackageSource; scope: packageManagerTypes.SourceScope }> {
    const result: Array<{
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }> = [];
    const seen = new Map<string, number>();
    for (const entry of packages) {
      const identity = this.getPackageIdentity(this.getPackageSourceString(entry.pkg), entry.scope);
      const index = seen.get(identity);
      if (index === undefined) {
        seen.set(identity, result.length);
        result.push(entry);
        continue;
      }
      const existing = result[index];
      if (existing?.scope === "project" && entry.scope === "user") {
        if (typeof existing.pkg === "object" && existing.pkg.autoload === false) result.push(entry);
      } else if (entry.scope === "project") {
        result[index] = entry;
      }
    }
    return result;
  }

  protected hasMissingGitDependencies(targetDir: string): boolean {
    const packageJsonPath = join(targetDir, "package.json");
    if (!existsSync(packageJsonPath)) return false;

    try {
      const manifest = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as {
        dependencies?: unknown;
      };
      if (
        typeof manifest.dependencies !== "object" ||
        manifest.dependencies === null ||
        Array.isArray(manifest.dependencies)
      ) {
        return false;
      }

      const nodeModulesDir = resolve(targetDir, "node_modules");
      return Object.keys(manifest.dependencies).some((name) => {
        const dependencyPath = resolve(nodeModulesDir, name);
        if (!dependencyPath.startsWith(`${nodeModulesDir}${sep}`)) return false;
        return !existsSync(dependencyPath);
      });
    } catch {
      return false;
    }
  }

  protected spawnCommand(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): nodeChildProcessTypes.ChildProcess {
    const env = getEnv();
    return spawnProcess(command, args, {
      cwd: options?.cwd,
      env,
      stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit",
    });
  }
}
