import * as Effect from "effect/Effect";
import { gt, maxSatisfying, rcompare } from "semver";

import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer6 from "./default-package-manager-layer-6.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { existsSync, writeFileSync } = nodeFs;
const { NETWORK_TIMEOUT_MS, UPDATE_CHECK_CONCURRENCY, isOfflineModeEnabled } =
  defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer7 extends DefaultPackageManagerLayer6 {
  protected shouldUpdateNpmSource(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: defaultPackageManagerInternalTypes.InstalledSourceScope,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const installedPath = this.getManagedNpmInstallPath(source, scope);
      const installedVersion = existsSync(installedPath)
        ? this.getInstalledNpmVersion(installedPath)
        : undefined;
      if (installedVersion === undefined || installedVersion === "") {
        return true;
      }

      try {
        const targetVersion = yield* awaited(
          this.getLatestNpmVersion(
            source.version !== undefined && source.version !== "" ? source.spec : source.name,
            source.range,
          ),
        );
        return gt(targetVersion, installedVersion);
      } catch {
        return true;
      }
    }, this);
  }

  checkForAvailableUpdates(): Promise<packageManagerTypes.PackageUpdate[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) {
          return [];
        }

        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        const allPackages: Array<{
          pkg: settingsManagerTypes.PackageSource;
          scope: packageManagerTypes.SourceScope;
        }> = [];
        for (const pkg of projectSettings.packages ?? []) {
          allPackages.push({ pkg, scope: "project" });
        }
        for (const pkg of globalSettings.packages ?? []) {
          allPackages.push({ pkg, scope: "user" });
        }

        const packageSources = this.dedupePackages(allPackages);
        const checks = packageSources
          .filter(
            (
              entry,
            ): entry is {
              pkg: settingsManagerTypes.PackageSource;
              scope: Exclude<packageManagerTypes.SourceScope, "temporary">;
            } => entry.scope !== "temporary",
          )
          .map(
            (entry) => (): Promise<packageManagerTypes.PackageUpdate | undefined> =>
              Effect.runPromise(
                awaitingWith(function* () {
                  const source = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
                  const parsed = this.parseSource(source);
                  if (parsed.type === "local" || parsed.pinned) {
                    return undefined;
                  }

                  if (parsed.type === "npm") {
                    const installedPath = this.getNpmInstallPath(parsed, entry.scope);
                    if (!existsSync(installedPath)) {
                      return undefined;
                    }
                    const hasUpdate = yield* performed(
                      this.npmHasAvailableUpdate(parsed, installedPath),
                    );
                    if (!hasUpdate) {
                      return undefined;
                    }
                    return {
                      displayName: parsed.name,
                      scope: entry.scope,
                      source,
                      type: "npm",
                    };
                  }

                  const installedPath = this.getGitInstallPath(parsed, entry.scope);
                  if (!existsSync(installedPath)) {
                    return undefined;
                  }
                  const hasUpdate = yield* awaited(this.gitHasAvailableUpdate(installedPath));
                  if (!hasUpdate) {
                    return undefined;
                  }
                  return {
                    displayName: `${parsed.host}/${parsed.path}`,
                    scope: entry.scope,
                    source,
                    type: "git",
                  };
                }, this),
              ),
          );

        const results = yield* performed(this.runWithConcurrency(checks, UPDATE_CHECK_CONCURRENCY));
        return results.filter(
          (result): result is packageManagerTypes.PackageUpdate => result !== undefined,
        );
      }, this),
    );
  }

  protected npmHasAvailableUpdate(
    source: defaultPackageManagerInternalTypes.NpmSource,
    installedPath: string,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (isOfflineModeEnabled()) {
        return false;
      }

      const installedVersion = this.getInstalledNpmVersion(installedPath);
      if (installedVersion === undefined || installedVersion === "") {
        return false;
      }

      try {
        const targetVersion = yield* awaited(
          this.getLatestNpmVersion(
            source.version !== undefined && source.version !== "" ? source.spec : source.name,
            source.range,
          ),
        );
        return gt(targetVersion, installedVersion);
      } catch {
        return false;
      }
    }, this);
  }

  protected getLatestNpmVersion(packageSpec: string, range?: string): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const npmCommand = this.getNpmCommand();
        const stdout = yield* awaited(
          this.runCommandCapture(
            npmCommand.command,
            [...npmCommand.args, "view", packageSpec, "version", "--json"],
            { cwd: this.cwd, timeoutMs: NETWORK_TIMEOUT_MS },
          ),
        );
        const raw = stdout.trim();
        if (raw === "") throw new Error("Empty response from npm view");
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === "string") {
          return parsed;
        }
        if (Array.isArray(parsed)) {
          const versions = parsed.filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          );
          const latest =
            range !== undefined && range !== ""
              ? maxSatisfying(versions, range)
              : [...versions].sort(rcompare)[0];
          if (latest !== undefined && latest !== null && latest !== "") return latest;
        }
        throw new Error("Unexpected response from npm view");
      }, this),
    );
  }

  protected ensureGitRef(targetDir: string, fetchArgs: string[], ref: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(this.runCommand("git", fetchArgs, { cwd: targetDir }));

      const localHead = yield* awaited(
        this.runCommandCapture("git", ["rev-parse", "HEAD"], {
          cwd: targetDir,
          timeoutMs: NETWORK_TIMEOUT_MS,
        }),
      );
      const commitRef = `${ref}^{commit}`;
      const targetHead = yield* awaited(
        this.runCommandCapture("git", ["rev-parse", commitRef], {
          cwd: targetDir,
          timeoutMs: NETWORK_TIMEOUT_MS,
        }),
      );
      const markerPath = this.getGitUpdateMarkerPath(targetDir);
      if (localHead.trim() === targetHead.trim()) {
        if (existsSync(markerPath)) {
          yield* performed(this.cleanAndInstallGitDependencies(targetDir, markerPath));
        } else {
          yield* performed(this.repairMissingGitDependencies(targetDir));
        }
        return;
      }

      writeFileSync(markerPath, "", "utf-8");
      yield* awaited(this.runCommand("git", ["reset", "--hard", commitRef], { cwd: targetDir }));
      yield* performed(this.cleanAndInstallGitDependencies(targetDir, markerPath));
    }, this);
  }
}
