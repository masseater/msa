import * as Effect from "effect/Effect";

import childProcess from "../utils/child-process.ts";
import type gitTypes from "../utils/git.types.ts";
import pathsModule from "../utils/paths.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer1 from "./default-package-manager-layer-1.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { existsSync, mkdirSync, rmSync, statSync, writeFileSync } = nodeFs;
const { canonicalizePath, markPathIgnoredByCloudSync, resolvePath } = pathsModule;
const { dirname, join, resolve } = platformNode;
const { spawnProcessSync } = childProcess;
const {
  applyPatterns,
  collectResourceFiles,
  expandPackageGlob,
  getEnv,
  getHomeDir,
  hasGlobPattern,
  isOverridePattern,
  resourcePrecedenceRank,
  splitPatterns,
} = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer2 extends DefaultPackageManagerLayer1 {
  protected runNpmCommandSync(args: string[]): string {
    const npmCommand = this.getNpmCommand();
    return this.runCommandSync(npmCommand.command, [...npmCommand.args, ...args]);
  }

  protected removeGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      const targetDir = this.getGitInstallPath(source, scope);
      rmSync(targetDir, { force: true, recursive: true });
      rmSync(this.getGitUpdateMarkerPath(targetDir), { force: true });
      this.pruneEmptyGitParents(targetDir, this.getGitInstallRoot(scope));
    });
  }

  protected ensureNpmProject(installRoot: string): void {
    if (!existsSync(installRoot)) {
      mkdirSync(installRoot, { recursive: true });
    }
    markPathIgnoredByCloudSync(installRoot);
    this.ensureGitIgnore(installRoot);
    const packageJsonPath = join(installRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      const pkgJson = { name: "msa-extensions", private: true };
      writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
    }
  }

  protected getGlobalNpmRoot(): string {
    const npmCommand = this.getNpmCommand();
    const commandKey = [npmCommand.command, ...npmCommand.args].join("\0");
    if (
      this.globalNpmRoot !== undefined &&
      this.globalNpmRoot !== "" &&
      this.globalNpmRootCommandKey === commandKey
    ) {
      return this.globalNpmRoot;
    }
    if (this.getPackageManagerName() === "bun") {
      const binDir = this.runNpmCommandSync(["pm", "bin", "-g"]).trim();
      this.globalNpmRoot = join(dirname(binDir), "install", "global", "node_modules");
    } else {
      this.globalNpmRoot = this.runNpmCommandSync(["root", "-g"]).trim();
    }
    this.globalNpmRootCommandKey = commandKey;
    return this.globalNpmRoot;
  }

  protected getPnpmGlobalPackagePath(packageName: string): string | undefined {
    if (this.getPackageManagerName() !== "pnpm") {
      return undefined;
    }

    const output = this.runNpmCommandSync(["list", "-g", "--depth", "0", "--json"]);
    const entries = JSON.parse(output) as Array<{
      dependencies?: Record<string, { path?: string }>;
    }>;
    for (const entry of entries) {
      const path = entry.dependencies?.[packageName]?.path;
      if (path !== undefined && path !== "") return path;
    }
    return undefined;
  }

  protected getLegacyGlobalNpmInstallPath(
    source: defaultPackageManagerInternalTypes.NpmSource,
  ): string | undefined {
    try {
      return (
        this.getPnpmGlobalPackagePath(source.name) ?? join(this.getGlobalNpmRoot(), source.name)
      );
    } catch {
      return undefined;
    }
  }

  protected getNpmInstallPath(
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

  protected getGitInstallPath(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): string {
    if (scope === "temporary") {
      return this.getTemporaryDir(`git-${source.host}`, source.path, source.ref);
    }
    const installRoot = this.getGitInstallRoot(scope);
    if (installRoot === undefined || installRoot === "") {
      throw new Error("Missing git install root");
    }
    return this.resolveManagedPath(installRoot, source.host, source.path);
  }

  protected resolvePath(input: string): string {
    return resolvePath(input, this.cwd, { homeDir: getHomeDir(), trim: true });
  }

  protected resolvePathFromBase(input: string, baseDir: string): string {
    return resolvePath(input, baseDir, { homeDir: getHomeDir(), trim: true });
  }

  protected addManifestEntries(
    entries: string[] | undefined,
    root: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    if (entries === undefined) return;

    const allFiles = this.collectFilesFromManifestEntries(entries, root, resourceType);
    const patterns = entries.filter(isOverridePattern);
    const enabledPaths = applyPatterns(allFiles, patterns, root);

    for (const f of allFiles) {
      if (enabledPaths.has(f)) {
        this.addResource(target, f, metadata, true);
      }
    }
  }

  protected collectFilesFromManifestEntries(
    entries: string[],
    root: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): string[] {
    const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
    const resolved = sourceEntries.flatMap((entry) => {
      if (!hasGlobPattern(entry)) {
        return [resolve(root, entry)];
      }

      return expandPackageGlob(entry, root);
    });
    return this.collectFilesFromPaths(resolved, resourceType);
  }

  protected resolveLocalEntries(
    entries: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
    baseDir: string,
  ): void {
    if (entries.length === 0) return;

    const { plain, patterns } = splitPatterns(entries);
    const resolvedPlain = plain.map((p) => this.resolvePathFromBase(p, baseDir));
    const allFiles = this.collectFilesFromPaths(resolvedPlain, resourceType);

    const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

    for (const f of allFiles) {
      this.addResource(target, f, metadata, enabledPaths.has(f));
    }
  }

  protected collectFilesFromPaths(
    paths: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): string[] {
    const files: string[] = [];
    for (const p of paths) {
      if (!existsSync(p)) continue;

      try {
        const stats = statSync(p);
        if (stats.isFile()) {
          files.push(p);
        } else if (stats.isDirectory()) {
          files.push(...collectResourceFiles(p, resourceType));
        }
      } catch {}
    }
    return files;
  }

  protected toResolvedPaths(
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
  ): packageManagerTypes.ResolvedPaths {
    const mapToResolved = (
      entries: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    ): packageManagerTypes.ResolvedResource[] => {
      const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
        enabled,
        metadata,
        path,
      }));
      resolved.sort(
        (a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata),
      );

      const seen = new Set<string>();
      return resolved.filter((entry) => {
        const canonicalPath = canonicalizePath(entry.path);
        if (seen.has(canonicalPath)) return false;
        seen.add(canonicalPath);
        return true;
      });
    };

    return {
      extensions: mapToResolved(accumulator.extensions),
      prompts: mapToResolved(accumulator.prompts),
      skills: mapToResolved(accumulator.skills),
      themes: mapToResolved(accumulator.themes),
    };
  }

  protected runCommandSync(command: string, args: string[]): string {
    const env = getEnv();
    const result = spawnProcessSync(command, args, {
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined || result.status !== 0) {
      throw new Error(
        `Failed to run ${command} ${args.join(" ")}: ${result.error?.message || result.stderr || result.stdout}`,
      );
    }
    return (result.stdout || result.stderr || "").trim();
  }
}
