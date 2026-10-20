import * as Effect from "effect/Effect";
import { satisfies } from "semver";

import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import nodeFs from "../platform/node/fs.ts";
const { existsSync } = nodeFs;
const { awaitingWith, performed } = awaitingModule;

export default class NpmInstalls {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  installedNpmMatchesConfiguredVersion(
    source: defaultPackageManagerInternalTypes.NpmSource,
    installedPath: string,
  ): Effect.Effect<boolean> {
    return Effect.sync(() => {
      const installedVersion = this.manager.npm.paths.getInstalledNpmVersion(installedPath);
      if (installedVersion === undefined || installedVersion === "") {
        return false;
      }
      return source.range !== undefined && source.range !== ""
        ? satisfies(installedVersion, source.range)
        : true;
    });
  }

  updateNpmBatch(
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
        this.manager.progress.withProgress("update", sourceLabel, message, () =>
          Effect.runPromise(
            awaitingWith(function* () {
              yield* performed(this.installNpmBatch(specs, scope));
            }, this),
          ),
        ),
      );
    }, this);
  }

  private installNpmBatch(
    specs: string[],
    scope: defaultPackageManagerInternalTypes.InstalledSourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.manager.npm.paths.getNpmInstallRoot(scope, false);
      this.manager.npm.paths.ensureNpmProject(installRoot);
      yield* performed(
        this.manager.npm.tool.runNpmCommand(
          this.manager.npm.tool.getNpmInstallArgs(specs, installRoot),
        ),
      );
    }, this);
  }

  installNpm(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
    temporary: boolean,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.manager.npm.paths.getNpmInstallRoot(scope, temporary);
      this.manager.npm.paths.ensureNpmProject(installRoot);
      yield* performed(
        this.manager.npm.tool.runNpmCommand(
          this.manager.npm.tool.getNpmInstallArgs([source.spec], installRoot),
        ),
      );
    }, this);
  }

  uninstallNpm(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const installRoot = this.manager.npm.paths.getNpmInstallRoot(scope, false);
      if (!existsSync(installRoot)) {
        return;
      }
      const packageManagerName = this.manager.npm.tool.getPackageManagerName();
      if (packageManagerName === "bun") {
        yield* performed(
          this.manager.npm.tool.runNpmCommand(["uninstall", source.name, "--cwd", installRoot]),
        );
        return;
      }
      const args = ["uninstall", source.name, "--prefix", installRoot];
      if (packageManagerName !== "pnpm") {
        args.push("--legacy-peer-deps");
      }
      yield* performed(this.manager.npm.tool.runNpmCommand(args));
    }, this);
  }
}
