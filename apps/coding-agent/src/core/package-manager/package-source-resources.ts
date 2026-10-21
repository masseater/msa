import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platform from "../platform/index.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import packageEnv from "./package-env.ts";

const { exists } = platform.files;
const { isOfflineModeEnabled } = packageEnv;
const { awaited, awaitingWith, performed } = awaitingModule;

type ResolvingSource = {
  filter: defaultPackageManagerInternalTypes.PackageFilter | undefined;
  metadata: packageManagerTypes.PathMetadata;
  parsed: defaultPackageManagerInternalTypes.ParsedSource;
  resolvedScope: packageManagerTypes.SourceScope;
  resolvedSource: string;
};

export default class PackageSourceResources {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  private installParsedSource(
    parsed: defaultPackageManagerInternalTypes.ParsedSource,
    scope: packageManagerTypes.SourceScope,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (parsed.type === "npm") {
          yield* performed(
            this.manager.npm.installs.installNpm(parsed, scope, scope === "temporary"),
          );
        } else if (parsed.type === "git") {
          yield* performed(this.manager.git.installs.installGit(parsed, scope));
        }
      }, this),
    );
  }

  resolvePackageSources(
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
        const deltaBase = this.manager.configured.findAutoloadDeltaBase(pkg, scope, sources);
        const source: ResolvingSource = {
          filter: typeof pkg === "object" ? pkg : undefined,
          metadata: { origin: "package", scope, source: sourceStr },
          parsed: this.manager.sources.parseSource(deltaBase?.source ?? sourceStr),
          resolvedScope: deltaBase?.scope ?? scope,
          resolvedSource: deltaBase?.source ?? sourceStr,
        };
        if (source.parsed.type === "local") {
          yield* awaited(
            this.manager.resources.collection.resolveLocalExtensionSource(
              source.parsed,
              accumulator,
              source.filter,
              source.metadata,
              this.manager.sources.getBaseDirForScope(source.resolvedScope),
            ),
          );
          continue;
        }
        const installedPath = yield* awaited(this.locateInstalledPath(source, onMissing));
        if (installedPath === undefined) continue;
        source.metadata.baseDir = installedPath;
        source.metadata.packageRoot = installedPath;
        yield* awaited(
          this.manager.resources.collection.collectPackageResources(
            installedPath,
            accumulator,
            source.filter,
            source.metadata,
          ),
        );
      }
    }, this);
  }

  private locateInstalledPath(
    source: ResolvingSource,
    onMissing?: (source: string) => Promise<packageManagerTypes.MissingSourceAction>,
  ): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const { parsed, resolvedScope } = source;
        if (parsed.type === "local") return undefined;
        const installMissing = () => this.installMissing(source, onMissing);
        if (parsed.type === "npm") {
          const { installs, paths } = this.manager.npm;
          const installedPath = paths.getNpmInstallPath(parsed, resolvedScope);
          const current =
            (yield* awaited(exists(installedPath))) &&
            (yield* performed(
              installs.installedNpmMatchesConfiguredVersion(parsed, installedPath),
            ));
          if (current) return installedPath;
          if (!(yield* awaited(installMissing()))) return undefined;
          return paths.getNpmInstallPath(parsed, resolvedScope);
        }
        const installedPath = this.manager.git.paths.getGitInstallPath(parsed, resolvedScope);
        if (!(yield* awaited(exists(installedPath)))) {
          return (yield* awaited(installMissing())) ? installedPath : undefined;
        }
        if (resolvedScope === "temporary" && !parsed.pinned && !isOfflineModeEnabled()) {
          yield* awaited(
            this.manager.git.installs.refreshTemporaryGitSource(parsed, source.resolvedSource),
          );
        }
        return installedPath;
      }, this),
    );
  }

  private installMissing(
    source: ResolvingSource,
    onMissing?: (source: string) => Promise<packageManagerTypes.MissingSourceAction>,
  ): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) return false;
        if (onMissing !== undefined) {
          const action = yield* awaited(onMissing(source.resolvedSource));
          if (action === "skip") return false;
          if (action === "error") throw new Error(`Missing source: ${source.resolvedSource}`);
        }
        yield* awaited(this.installParsedSource(source.parsed, source.resolvedScope));
        return true;
      }, this),
    );
  }
}
