import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import defaultPackageManagerHelpers from "../default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import nodeFs from "../platform/node/fs.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import concurrency from "./concurrency.ts";
import gitRemote from "./git-remote.ts";

const { existsSync } = nodeFs;
const { isOfflineModeEnabled, UPDATE_CHECK_CONCURRENCY } = defaultPackageManagerHelpers;
const { awaited, awaitingWith, performed } = awaitingModule;
const { runWithConcurrency } = concurrency;

type ConfiguredEntry = {
  pkg: settingsManagerTypes.PackageSource;
  scope: Exclude<packageManagerTypes.SourceScope, "temporary">;
};
type Update = packageManagerTypes.PackageUpdate | undefined;
type Parsed = defaultPackageManagerInternalTypes.ParsedSource;

export default class PackageUpdateCheck {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  checkForAvailableUpdates(): Promise<packageManagerTypes.PackageUpdate[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) {
          return [];
        }
        const checks = this.configuredEntries().map((entry) => () => this.checkEntry(entry));
        const results = yield* performed(runWithConcurrency(checks, UPDATE_CHECK_CONCURRENCY));
        return results.filter(
          (result): result is packageManagerTypes.PackageUpdate => result !== undefined,
        );
      }, this),
    );
  }

  private configuredEntries(): ConfiguredEntry[] {
    const settings = this.manager.settingsManager;
    const allPackages = [
      ...(settings.getProjectSettings().packages ?? []).map((pkg) => ({
        pkg,
        scope: "project" as const,
      })),
      ...(settings.getGlobalSettings().packages ?? []).map((pkg) => ({
        pkg,
        scope: "user" as const,
      })),
    ];
    return this.manager.configured
      .dedupePackages(allPackages)
      .filter((entry): entry is ConfiguredEntry => entry.scope !== "temporary");
  }

  private checkEntry(entry: ConfiguredEntry): Promise<Update> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const source = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
        const parsed = this.manager.sources.parseSource(source);
        if (parsed.type === "local" || parsed.pinned) {
          return undefined;
        }
        if (parsed.type === "npm") {
          return yield* performed(this.checkNpm(parsed, entry.scope, source));
        }
        return yield* awaited(this.checkGit(parsed, entry.scope, source));
      }, this),
    );
  }

  private checkNpm(
    parsed: Extract<Parsed, { type: "npm" }>,
    scope: ConfiguredEntry["scope"],
    source: string,
  ): Effect.Effect<Update> {
    return awaitingWith(function* () {
      const installedPath = this.manager.npm.paths.getNpmInstallPath(parsed, scope);
      if (!existsSync(installedPath)) {
        return undefined;
      }
      const hasUpdate = yield* performed(
        this.manager.npm.updates.npmHasAvailableUpdate(parsed, installedPath),
      );
      return hasUpdate
        ? { displayName: parsed.name, scope, source, type: "npm" as const }
        : undefined;
    }, this);
  }

  private checkGit(
    parsed: Extract<Parsed, { type: "git" }>,
    scope: ConfiguredEntry["scope"],
    source: string,
  ): Promise<Update> {
    const installedPath = this.manager.git.paths.getGitInstallPath(parsed, scope);
    if (!existsSync(installedPath)) {
      return Promise.resolve(undefined);
    }
    return gitRemote
      .gitHasAvailableUpdate(installedPath)
      .then((hasUpdate) =>
        hasUpdate
          ? { displayName: `${parsed.host}/${parsed.path}`, scope, source, type: "git" as const }
          : undefined,
      );
  }
}
