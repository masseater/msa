import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import nodeFs from "../platform/node/fs.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";

const { existsSync } = nodeFs;

export default class ConfiguredPackages {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  addSourceToSettings(source: string, options?: { local?: boolean }): boolean {
    const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
    const currentSettings =
      scope === "project"
        ? this.manager.settingsManager.getProjectSettings()
        : this.manager.settingsManager.getGlobalSettings();
    const currentPackages = currentSettings.packages ?? [];
    const normalizedSource = this.manager.sources.normalizePackageSourceForSettings(source, scope);
    const matchIndex = currentPackages.findIndex((existing) =>
      this.manager.sources.packageSourcesMatch(existing, source, scope),
    );
    const existing = currentPackages[matchIndex];
    if (existing !== undefined) {
      if (this.manager.sources.getPackageSourceString(existing) === normalizedSource) {
        return false;
      }
      const nextPackages = [...currentPackages];
      nextPackages[matchIndex] =
        typeof existing === "string" ? normalizedSource : { ...existing, source: normalizedSource };
      if (scope === "project") {
        this.manager.settingsManager.resources.setProjectPackages(nextPackages);
      } else {
        this.manager.settingsManager.resources.setPackages(nextPackages);
      }
      return true;
    }
    const nextPackages = [...currentPackages, normalizedSource];
    if (scope === "project") {
      this.manager.settingsManager.resources.setProjectPackages(nextPackages);
    } else {
      this.manager.settingsManager.resources.setPackages(nextPackages);
    }
    return true;
  }

  removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean {
    const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
    const currentSettings =
      scope === "project"
        ? this.manager.settingsManager.getProjectSettings()
        : this.manager.settingsManager.getGlobalSettings();
    const currentPackages = currentSettings.packages ?? [];
    const nextPackages = currentPackages.filter(
      (existing) => !this.manager.sources.packageSourcesMatch(existing, source, scope),
    );
    const changed = nextPackages.length !== currentPackages.length;
    if (!changed) {
      return false;
    }
    if (scope === "project") {
      this.manager.settingsManager.resources.setProjectPackages(nextPackages);
    } else {
      this.manager.settingsManager.resources.setPackages(nextPackages);
    }
    return true;
  }

  getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
    const parsed = this.manager.sources.parseSource(source);
    if (parsed.type === "npm") {
      const path = this.manager.npm.paths.getNpmInstallPath(parsed, scope);
      return existsSync(path) ? path : undefined;
    }
    if (parsed.type === "git") {
      const path = this.manager.git.paths.getGitInstallPath(parsed, scope);
      return existsSync(path) ? path : undefined;
    }
    if (parsed.type === "local") {
      const baseDir = this.manager.sources.getBaseDirForScope(scope);
      const path = this.manager.sources.resolvePathFromBase(parsed.path, baseDir);
      return existsSync(path) ? path : undefined;
    }
    return undefined;
  }

  listConfiguredPackages(): packageManagerTypes.ConfiguredPackage[] {
    const globalSettings = this.manager.settingsManager.getGlobalSettings();
    const projectSettings = this.manager.settingsManager.getProjectSettings();
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

  findAutoloadDeltaBase(
    pkg: settingsManagerTypes.PackageSource,
    scope: packageManagerTypes.SourceScope,
    sources: Array<{
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }>,
  ): { source: string; scope: packageManagerTypes.SourceScope } | undefined {
    if (scope !== "project" || typeof pkg !== "object" || pkg.autoload !== false) return undefined;
    const identity = this.manager.sources.getPackageIdentity(pkg.source, scope);
    const userEntry = sources.find(
      (entry) =>
        entry.scope === "user" &&
        this.manager.sources.getPackageIdentity(
          this.manager.sources.getPackageSourceString(entry.pkg),
          "user",
        ) === identity,
    );
    return userEntry === undefined
      ? undefined
      : { scope: "user", source: this.manager.sources.getPackageSourceString(userEntry.pkg) };
  }

  buildNoMatchingPackageMessage(
    source: string,
    configuredPackages: settingsManagerTypes.PackageSource[],
  ): string {
    const suggestion = this.findSuggestedConfiguredSource(source, configuredPackages);
    if (suggestion === undefined || suggestion === "") {
      return `No matching package found for ${source}`;
    }
    return `No matching package found for ${source}. Did you mean ${suggestion}?`;
  }

  private findSuggestedConfiguredSource(
    source: string,
    configuredPackages: settingsManagerTypes.PackageSource[],
  ): string | undefined {
    const trimmedSource = source.trim();
    const suggestions = new Set<string>();

    for (const pkg of configuredPackages) {
      const sourceStr = this.manager.sources.getPackageSourceString(pkg);
      const parsed = this.manager.sources.parseSource(sourceStr);
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

  dedupePackages(
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
      const identity = this.manager.sources.getPackageIdentity(
        this.manager.sources.getPackageSourceString(entry.pkg),
        entry.scope,
      );
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
}
