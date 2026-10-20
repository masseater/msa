import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer9 from "./default-package-manager-layer-9.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import nodeFs from "./platform/node/fs.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import sourceInfo from "./source-info.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { BUILTIN_PATH_PREFIX } = sourceInfo;
const { existsSync } = nodeFs;
const { isOfflineModeEnabled } = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer10 extends DefaultPackageManagerLayer9 {
  resolveExtensionSources(
    sources: string[],
    options?: { local?: boolean; temporary?: boolean },
  ): Promise<packageManagerTypes.ResolvedPaths> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const accumulator = this.createAccumulator();
        const scope: packageManagerTypes.SourceScope =
          options?.temporary === true ? "temporary" : options?.local === true ? "project" : "user";
        for (const source of sources.filter((candidate) =>
          candidate.startsWith(BUILTIN_PATH_PREFIX),
        )) {
          this.addResource(
            accumulator.extensions,
            source,
            { origin: "top-level", scope, source: "builtin" },
            true,
          );
        }
        const packageSources = sources
          .filter((source) => !source.startsWith(BUILTIN_PATH_PREFIX))
          .map((source) => ({ pkg: source as settingsManagerTypes.PackageSource, scope }));
        yield* performed(this.resolvePackageSources(packageSources, accumulator));
        return this.toResolvedPaths(accumulator);
      }, this),
    );
  }

  update(source?: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const globalSettings = this.settingsManager.getGlobalSettings();
        const projectSettings = this.settingsManager.getProjectSettings();
        const identity =
          source !== undefined && source !== "" ? this.getPackageIdentity(source) : undefined;
        let matched = false;
        const updateSources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[] = [];

        for (const pkg of globalSettings.packages ?? []) {
          const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
          if (
            identity !== undefined &&
            identity !== "" &&
            this.getPackageIdentity(sourceStr, "user") !== identity
          )
            continue;
          matched = true;
          updateSources.push({ scope: "user", source: sourceStr });
        }
        for (const pkg of projectSettings.packages ?? []) {
          const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
          if (
            identity !== undefined &&
            identity !== "" &&
            this.getPackageIdentity(sourceStr, "project") !== identity
          )
            continue;
          matched = true;
          updateSources.push({ scope: "project", source: sourceStr });
        }

        if (source !== undefined && source !== "" && !matched) {
          throw new Error(
            this.buildNoMatchingPackageMessage(source, [
              ...(globalSettings.packages ?? []),
              ...(projectSettings.packages ?? []),
            ]),
          );
        }

        yield* performed(this.updateConfiguredSources(updateSources));
      }, this),
    );
  }

  protected resolvePackageSources(
    sources: Array<{
      pkg: settingsManagerTypes.PackageSource;
      scope: packageManagerTypes.SourceScope;
    }>,
    accumulator: defaultPackageManagerInternalTypes.ResourceAccumulator,
    onMissing?: (source: string) => Promise<packageManagerTypes.MissingSourceAction>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      for (const { pkg, scope } of sources) {
        const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
        const filter = typeof pkg === "object" ? pkg : undefined;
        const deltaBase = this.findAutoloadDeltaBase(pkg, scope, sources);
        const resolvedSource = deltaBase?.source ?? sourceStr;
        const resolvedScope = deltaBase?.scope ?? scope;
        const parsed = this.parseSource(resolvedSource);
        const metadata: packageManagerTypes.PathMetadata = {
          origin: "package",
          scope,
          source: sourceStr,
        };

        if (parsed.type === "local") {
          const baseDir = this.getBaseDirForScope(resolvedScope);
          this.resolveLocalExtensionSource(parsed, accumulator, filter, metadata, baseDir);
          continue;
        }

        const installMissing = (): Promise<boolean> =>
          Effect.runPromise(
            awaitingWith(function* () {
              if (isOfflineModeEnabled()) return false;
              if (onMissing === undefined) {
                yield* awaited(this.installParsedSource(parsed, resolvedScope));
                return true;
              }
              const action = yield* awaited(onMissing(resolvedSource));
              if (action === "skip") return false;
              if (action === "error") throw new Error(`Missing source: ${resolvedSource}`);
              yield* awaited(this.installParsedSource(parsed, resolvedScope));
              return true;
            }, this),
          );

        if (parsed.type === "npm") {
          let installedPath = this.getNpmInstallPath(parsed, resolvedScope);
          const needsInstall =
            !existsSync(installedPath) ||
            !(yield* performed(this.installedNpmMatchesConfiguredVersion(parsed, installedPath)));
          if (needsInstall) {
            const installed = yield* awaited(installMissing());
            if (!installed) continue;
            installedPath = this.getNpmInstallPath(parsed, resolvedScope);
          }
          metadata.baseDir = installedPath;
          metadata.packageRoot = installedPath;
          this.collectPackageResources(installedPath, accumulator, filter, metadata);
          continue;
        }

        if (parsed.type === "git") {
          const installedPath = this.getGitInstallPath(parsed, resolvedScope);
          if (!existsSync(installedPath)) {
            const installed = yield* awaited(installMissing());
            if (!installed) continue;
          } else if (resolvedScope === "temporary" && !parsed.pinned && !isOfflineModeEnabled()) {
            yield* awaited(this.refreshTemporaryGitSource(parsed, resolvedSource));
          }
          metadata.baseDir = installedPath;
          metadata.packageRoot = installedPath;
          this.collectPackageResources(installedPath, accumulator, filter, metadata);
        }
      }
    }, this);
  }
}
