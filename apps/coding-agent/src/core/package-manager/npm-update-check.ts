import * as Effect from "effect/Effect";
import { gt, maxSatisfying, rcompare } from "semver";

import awaitingModule from "../awaiting.ts";
import defaultPackageManagerHelpers from "../default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import nodeFs from "../platform/node/fs.ts";
import commandRunner from "./command-runner.ts";

const { existsSync } = nodeFs;
const { NETWORK_TIMEOUT_MS, isOfflineModeEnabled } = defaultPackageManagerHelpers;
const { awaited, awaitingWith } = awaitingModule;

export default class NpmUpdateCheck {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  shouldUpdateNpmSource(
    source: defaultPackageManagerInternalTypes.NpmSource,
    scope: defaultPackageManagerInternalTypes.InstalledSourceScope,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      const installedPath = this.manager.npm.paths.getManagedNpmInstallPath(source, scope);
      const installedVersion = existsSync(installedPath)
        ? this.manager.npm.paths.getInstalledNpmVersion(installedPath)
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

  npmHasAvailableUpdate(
    source: defaultPackageManagerInternalTypes.NpmSource,
    installedPath: string,
  ): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (isOfflineModeEnabled()) {
        return false;
      }

      const installedVersion = this.manager.npm.paths.getInstalledNpmVersion(installedPath);
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

  getLatestNpmVersion(packageSpec: string, range?: string): Promise<string> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const npmCommand = this.manager.npm.tool.getNpmCommand();
        const stdout = yield* awaited(
          commandRunner.runCommandCapture(
            npmCommand.command,
            [...npmCommand.args, "view", packageSpec, "version", "--json"],
            { cwd: this.manager.cwd, timeoutMs: NETWORK_TIMEOUT_MS },
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
}
