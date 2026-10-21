import * as Effect from "effect/Effect";

import type gitTypes from "../../utils/git.types.ts";
import awaitingModule from "../awaiting.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import packageManager from "../package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";
import commandRunner from "./command-runner.ts";
import gitRemote from "./git-remote.ts";
import packageEnv from "./package-env.ts";

const { dirname, join } = platformModule;
const { exists, makeDirectory, remove, writeFile } = platformModule.files;
const { ensureExtensionTempFolder } = packageManager;
const { NETWORK_TIMEOUT_MS, isOfflineModeEnabled } = packageEnv;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class GitInstalls {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  removeGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const { paths } = this.manager.git;
      const targetDir = paths.getGitInstallPath(source, scope);
      yield* awaited(remove({ force: true, path: targetDir, recursive: true }));
      yield* awaited(remove({ force: true, path: paths.getGitUpdateMarkerPath(targetDir) }));
      yield* awaited(paths.pruneEmptyGitParents(targetDir, paths.getGitInstallRoot(scope)));
    }, this);
  }

  private ensureGitRef(targetDir: string, fetchArgs: string[], ref: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(commandRunner.runCommand("git", fetchArgs, { cwd: targetDir }));

      const localHead = yield* awaited(
        commandRunner.runCommandCapture("git", ["rev-parse", "HEAD"], {
          cwd: targetDir,
          timeoutMs: NETWORK_TIMEOUT_MS,
        }),
      );
      const commitRef = `${ref}^{commit}`;
      const targetHead = yield* awaited(
        commandRunner.runCommandCapture("git", ["rev-parse", commitRef], {
          cwd: targetDir,
          timeoutMs: NETWORK_TIMEOUT_MS,
        }),
      );
      const markerPath = this.manager.git.paths.getGitUpdateMarkerPath(targetDir);
      if (localHead.trim() === targetHead.trim()) {
        if (yield* awaited(exists(markerPath))) {
          yield* performed(
            this.manager.git.dependencies.cleanAndInstallGitDependencies(targetDir, markerPath),
          );
        } else {
          yield* performed(this.manager.git.dependencies.repairMissingGitDependencies(targetDir));
        }
        return;
      }

      yield* awaited(writeFile({ data: "", path: markerPath }));
      yield* awaited(
        commandRunner.runCommand("git", ["reset", "--hard", commitRef], { cwd: targetDir }),
      );
      yield* performed(
        this.manager.git.dependencies.cleanAndInstallGitDependencies(targetDir, markerPath),
      );
    }, this);
  }

  private updateExistingGit(targetDir: string, source: gitTypes.GitSource): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (source.ref !== undefined && source.ref !== "") {
        yield* performed(
          this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD"),
        );
        return;
      }
      const target = yield* awaited(gitRemote.getLocalGitUpdateTarget(targetDir));
      yield* performed(this.ensureGitRef(targetDir, target.fetchArgs, target.ref));
    }, this);
  }

  private prepareClone(
    targetDir: string,
    scope: packageManagerTypes.SourceScope,
    gitRoot: string | undefined,
  ): Promise<void> {
    const { paths } = this.manager.git;
    return (
      gitRoot === undefined || gitRoot === "" ? Promise.resolve() : paths.ensureGitIgnore(gitRoot)
    )
      .then(() =>
        scope === "temporary" ? ensureExtensionTempFolder(this.manager.agentDir) : undefined,
      )
      .then(() => makeDirectory({ path: dirname(targetDir) }))
      .then(() => remove({ force: true, path: paths.getGitUpdateMarkerPath(targetDir) }));
  }

  installGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const targetDir = this.manager.git.paths.getGitInstallPath(source, scope);
      if (yield* awaited(exists(targetDir))) {
        yield* performed(this.updateExistingGit(targetDir, source));
        return;
      }
      const gitRoot = this.manager.git.paths.getGitInstallRoot(scope);
      yield* awaited(this.prepareClone(targetDir, scope, gitRoot));

      try {
        yield* awaited(commandRunner.runCommand("git", ["clone", source.repo, targetDir]));
        if (source.ref !== undefined && source.ref !== "") {
          yield* awaited(
            commandRunner.runCommand("git", ["checkout", source.ref], { cwd: targetDir }),
          );
        }
        const packageJsonPath = join(targetDir, "package.json");
        if (yield* awaited(exists(packageJsonPath))) {
          yield* performed(
            this.manager.npm.tool.runNpmCommand(
              this.manager.npm.tool.getGitDependencyInstallArgs(),
              { cwd: targetDir },
            ),
          );
        }
      } catch (error) {
        yield* awaited(remove({ force: true, path: targetDir, recursive: true }));
        yield* awaited(this.manager.git.paths.pruneEmptyGitParents(targetDir, gitRoot));
        throw error;
      }
    }, this);
  }

  updateGit(source: gitTypes.GitSource, scope: packageManagerTypes.SourceScope): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const targetDir = this.manager.git.paths.getGitInstallPath(source, scope);
        if (!(yield* awaited(exists(targetDir)))) {
          yield* performed(this.installGit(source, scope));
          return;
        }
        yield* performed(this.updateExistingGit(targetDir, source));
      }, this),
    );
  }

  refreshTemporaryGitSource(source: gitTypes.GitSource, sourceStr: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) {
          return;
        }
        try {
          yield* performed(
            this.manager.progress.withProgress(
              "pull",
              sourceStr,
              `Refreshing ${sourceStr}...`,
              () =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    yield* awaited(this.updateGit(source, "temporary"));
                  }, this),
                ),
            ),
          );
        } catch {}
      }, this),
    );
  }
}
