import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import concurrency from "./concurrency.ts";
import packageEnv from "./package-env.ts";

const { isOfflineModeEnabled, UPDATE_CHECK_CONCURRENCY, GIT_UPDATE_CONCURRENCY } = packageEnv;
const { awaited, awaitingWith, performed } = awaitingModule;
const { runWithConcurrency } = concurrency;

export default class PackageUpdates {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  private updateConfiguredSources(
    sources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[],
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (isOfflineModeEnabled() || sources.length === 0) {
        return;
      }
      const npmCandidates: defaultPackageManagerInternalTypes.NpmUpdateTarget[] = [];
      const gitCandidates: defaultPackageManagerInternalTypes.GitUpdateTarget[] = [];
      const { userNpmUpdates, projectNpmUpdates } = yield* this.planNpmUpdates(
        sources,
        npmCandidates,
        gitCandidates,
      );
      const { installs } = this.manager.npm;
      const tasks: Promise<void>[] = [];
      if (userNpmUpdates.length > 0) {
        tasks.push(Effect.runPromise(installs.updateNpmBatch(userNpmUpdates, "user")));
      }
      if (projectNpmUpdates.length > 0) {
        tasks.push(Effect.runPromise(installs.updateNpmBatch(projectNpmUpdates, "project")));
      }
      if (gitCandidates.length > 0) {
        tasks.push(this.updateGitSources(gitCandidates));
      }
      yield* awaited(Promise.all(tasks));
    }, this);
  }

  private updateGitSources(
    candidates: defaultPackageManagerInternalTypes.GitUpdateTarget[],
  ): Promise<void> {
    const { manager } = this;
    const gitTasks = candidates.map(
      (entry) => () =>
        Effect.runPromise(
          manager.progress.withProgress("update", entry.source, `Updating ${entry.source}...`, () =>
            manager.git.installs.updateGit(entry.parsed, entry.scope),
          ),
        ),
    );
    return Effect.runPromise(runWithConcurrency(gitTasks, GIT_UPDATE_CONCURRENCY)).then(
      () => undefined,
    );
  }

  private *planNpmUpdates(
    sources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[],
    npmCandidates: defaultPackageManagerInternalTypes.NpmUpdateTarget[],
    gitCandidates: defaultPackageManagerInternalTypes.GitUpdateTarget[],
  ) {
    for (const entry of sources) {
      const parsed = this.manager.sources.parseSource(entry.source);
      if (parsed.type === "npm") {
        if (!parsed.pinned) {
          npmCandidates.push({ ...entry, parsed });
        }
      } else if (parsed.type === "git") {
        gitCandidates.push({ ...entry, parsed });
      }
    }

    const npmCheckTasks = npmCandidates.map(
      (entry) => () =>
        Effect.runPromise(
          awaitingWith(function* () {
            return {
              entry,
              shouldUpdate: yield* performed(
                this.manager.npm.updates.shouldUpdateNpmSource(entry.parsed, entry.scope),
              ),
            };
          }, this),
        ),
    );
    const npmCheckResults = yield* performed(
      runWithConcurrency(npmCheckTasks, UPDATE_CHECK_CONCURRENCY),
    );
    const userNpmUpdates: defaultPackageManagerInternalTypes.NpmUpdateTarget[] = [];
    const projectNpmUpdates: defaultPackageManagerInternalTypes.NpmUpdateTarget[] = [];
    for (const result of npmCheckResults) {
      if (!result.shouldUpdate) {
        continue;
      }
      if (result.entry.scope === "user") {
        userNpmUpdates.push(result.entry);
      } else {
        projectNpmUpdates.push(result.entry);
      }
    }
    return { projectNpmUpdates, userNpmUpdates };
  }

  update(source?: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const globalSettings = this.manager.settingsManager.getGlobalSettings();
        const projectSettings = this.manager.settingsManager.getProjectSettings();
        const identity =
          source !== undefined && source !== ""
            ? this.manager.sources.getPackageIdentity(source)
            : undefined;
        let matched = false;
        const updateSources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[] = [];

        for (const pkg of globalSettings.packages ?? []) {
          const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
          if (
            identity !== undefined &&
            identity !== "" &&
            this.manager.sources.getPackageIdentity(sourceStr, "user") !== identity
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
            this.manager.sources.getPackageIdentity(sourceStr, "project") !== identity
          )
            continue;
          matched = true;
          updateSources.push({ scope: "project", source: sourceStr });
        }

        if (source !== undefined && source !== "" && !matched) {
          throw new Error(
            this.manager.configured.buildNoMatchingPackageMessage(source, [
              ...(globalSettings.packages ?? []),
              ...(projectSettings.packages ?? []),
            ]),
          );
        }

        yield* performed(this.updateConfiguredSources(updateSources));
      }, this),
    );
  }
}
