import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer4 from "./default-package-manager-layer-4.ts";
import manifestModule from "./manifest.ts";
import type manifestTypes from "./manifest.types.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { existsSync, rmSync } = nodeFs;
const { join } = platformNode;
const { readMsaManifest } = manifestModule;
const { applyAutoloadDisabledPatterns, applyPatterns, collectResourceFiles, isOverridePattern } =
  defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer5 extends DefaultPackageManagerLayer4 {
  remove(source: string, options?: { local?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const parsed = this.parseSource(source);
        const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
        this.assertProjectTrustedForScope(scope);
        yield* performed(
          this.withProgress("remove", source, `Removing ${source}...`, () =>
            Effect.runPromise(
              awaitingWith(function* () {
                if (parsed.type === "npm") {
                  yield* performed(this.uninstallNpm(parsed, scope));
                  return;
                }
                if (parsed.type === "git") {
                  yield* performed(this.removeGit(parsed, scope));
                  return;
                }
                if (parsed.type === "local") {
                  return;
                }
                throw new Error(`Unsupported remove source: ${source}`);
              }, this),
            ),
          ),
        );
      }, this),
    );
  }

  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.remove(source, options));
        return this.removeSourceFromSettings(source, options);
      }, this),
    );
  }

  protected updateNpmBatch(
    sources: defaultPackageManagerInternalTypes.NpmUpdateTarget[],
    scope: defaultPackageManagerInternalTypes.InstalledSourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (sources.length === 0) {
        return;
      }

      const singleSource = sources.length === 1 ? sources[0] : undefined;
      const sourceLabel =
        singleSource === undefined ? `${scope} npm packages` : singleSource.source;
      const message =
        singleSource === undefined
          ? `Updating ${scope} npm packages...`
          : `Updating ${singleSource.source}...`;
      const specs = sources.map((entry) =>
        entry.parsed.version !== undefined && entry.parsed.version !== ""
          ? entry.parsed.spec
          : `${entry.parsed.name}@latest`,
      );

      yield* performed(
        this.withProgress("update", sourceLabel, message, () =>
          Effect.runPromise(
            awaitingWith(function* () {
              yield* performed(this.installNpmBatch(specs, scope));
            }, this),
          ),
        ),
      );
    }, this);
  }

  protected installNpmBatch(
    specs: string[],
    scope: defaultPackageManagerInternalTypes.InstalledSourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.getNpmInstallRoot(scope, false);
      this.ensureNpmProject(installRoot);
      yield* performed(this.runNpmCommand(this.getNpmInstallArgs(specs, installRoot)));
    }, this);
  }

  protected runNpmCommand(args: string[], options?: { cwd?: string }): Effect.Effect<void> {
    return awaitingWith(function* () {
      const npmCommand = this.getNpmCommand();
      yield* awaited(this.runCommand(npmCommand.command, [...npmCommand.args, ...args], options));
    }, this);
  }

  protected installNpm(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
    temporary: boolean,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.getNpmInstallRoot(scope, temporary);
      this.ensureNpmProject(installRoot);
      yield* performed(this.runNpmCommand(this.getNpmInstallArgs([source.spec], installRoot)));
    }, this);
  }

  protected uninstallNpm(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.getNpmInstallRoot(scope, false);
      if (!existsSync(installRoot)) {
        return;
      }
      const packageManagerName = this.getPackageManagerName();
      if (packageManagerName === "bun") {
        yield* performed(this.runNpmCommand(["uninstall", source.name, "--cwd", installRoot]));
        return;
      }
      const args = ["uninstall", source.name, "--prefix", installRoot];
      if (packageManagerName !== "pnpm") {
        args.push("--legacy-peer-deps");
      }
      yield* performed(this.runNpmCommand(args));
    }, this);
  }

  protected repairMissingGitDependencies(targetDir: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.hasMissingGitDependencies(targetDir)) return;
      yield* performed(this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir }));
    }, this);
  }

  protected cleanAndInstallGitDependencies(
    targetDir: string,
    markerPath: string,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        yield* awaited(this.runCommand("git", ["clean", "-fdx"], { cwd: targetDir }));
      } catch (error) {
        yield* awaited(
          Effect.runPromise(this.repairMissingGitDependencies(targetDir)).catch(() => {}),
        );
        throw error;
      }

      const packageJsonPath = join(targetDir, "package.json");
      if (existsSync(packageJsonPath)) {
        yield* performed(
          this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir }),
        );
      }
      rmSync(markerPath, { force: true });
    }, this);
  }

  protected collectDefaultResources(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
    if (entries !== undefined) {
      this.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
      return;
    }
    const dir = join(packageRoot, resourceType);
    if (existsSync(dir)) {
      const files = collectResourceFiles(dir, resourceType);
      for (const f of files) {
        this.addResource(target, f, metadata, true);
      }
    }
  }

  protected applyPackageFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);

    if (userPatterns.length === 0) {
      for (const f of allFiles) {
        this.addResource(target, f, metadata, false);
      }
      return;
    }

    const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);

    for (const f of allFiles) {
      const enabled = enabledByUser.has(f);
      this.addResource(target, f, metadata, enabled);
    }
  }

  protected applyPackageDeltaFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
    target: Map<string, { metadata: packageManagerTypes.PathMetadata; enabled: boolean }>,
    metadata: packageManagerTypes.PathMetadata,
  ): void {
    if (userPatterns.length === 0) {
      return;
    }

    const { allFiles } = this.collectManifestFiles(packageRoot, resourceType);
    const enabledByUser = applyAutoloadDisabledPatterns(allFiles, userPatterns, packageRoot);
    for (const [filePath, enabled] of enabledByUser) {
      this.addResource(target, filePath, metadata, enabled);
    }
  }

  protected collectManifestFiles(
    packageRoot: string,
    resourceType: defaultPackageManagerInternalTypes.ResourceType,
  ): { allFiles: string[]; enabledByManifest: Set<string> } {
    const manifest = readMsaManifest(join(packageRoot, "package.json"));
    const entries = manifest?.[resourceType as keyof manifestTypes.MsaManifest];
    if (entries !== undefined && entries.length > 0) {
      const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
      const manifestPatterns = entries.filter(isOverridePattern);
      const enabledByManifest =
        manifestPatterns.length > 0
          ? applyPatterns(allFiles, manifestPatterns, packageRoot)
          : new Set(allFiles);
      return { allFiles: Array.from(enabledByManifest), enabledByManifest };
    }

    const conventionDir = join(packageRoot, resourceType);
    if (!existsSync(conventionDir)) {
      return { allFiles: [], enabledByManifest: new Set() };
    }
    const allFiles = collectResourceFiles(conventionDir, resourceType);
    return { allFiles, enabledByManifest: new Set(allFiles) };
  }

  protected runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
    return Effect.runPromise(
      Effect.callback<void>((resume) => {
        const child = this.spawnCommand(command, args, options);
        child.on("error", (error) => {
          resume(Effect.die(error));
        });
        child.on("exit", (code) => {
          if (code === 0) {
            resume(Effect.void);
          } else {
            resume(Effect.die(new Error(`${command} ${args.join(" ")} failed with code ${code}`)));
          }
        });
      }),
    );
  }
}
