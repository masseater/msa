import * as Effect from "effect/Effect";

import type gitTypes from "../../utils/git.types.ts";
import awaitingModule from "../awaiting.ts";
import defaultPackageManagerHelpers from "../default-package-manager-helpers.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import commandRunner from "./command-runner.ts";
import gitRemote from "./git-remote.ts";

const { dirname, join } = platformNode;
const { existsSync, mkdirSync, rmSync, writeFileSync } = nodeFs;
const { NETWORK_TIMEOUT_MS, isOfflineModeEnabled } = defaultPackageManagerHelpers;
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
    return Effect.sync(() => {
      const targetDir = this.manager.git.paths.getGitInstallPath(source, scope);
      rmSync(targetDir, { force: true, recursive: true });
      rmSync(this.manager.git.paths.getGitUpdateMarkerPath(targetDir), { force: true });
      this.manager.git.paths.pruneEmptyGitParents(
        targetDir,
        this.manager.git.paths.getGitInstallRoot(scope),
      );
    });
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
        if (existsSync(markerPath)) {
          yield* performed(
            this.manager.git.dependencies.cleanAndInstallGitDependencies(targetDir, markerPath),
          );
        } else {
          yield* performed(this.manager.git.dependencies.repairMissingGitDependencies(targetDir));
        }
        return;
      }

      writeFileSync(markerPath, "", "utf-8");
      yield* awaited(
        commandRunner.runCommand("git", ["reset", "--hard", commitRef], { cwd: targetDir }),
      );
      yield* performed(
        this.manager.git.dependencies.cleanAndInstallGitDependencies(targetDir, markerPath),
      );
    }, this);
  }

  installGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const targetDir = this.manager.git.paths.getGitInstallPath(source, scope);
      if (existsSync(targetDir)) {
        if (source.ref !== undefined && source.ref !== "") {
          yield* performed(
            this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD"),
          );
          return;
        }
        const target = yield* awaited(gitRemote.getLocalGitUpdateTarget(targetDir));
        yield* performed(this.ensureGitRef(targetDir, target.fetchArgs, target.ref));
        return;
      }
      const gitRoot = this.manager.git.paths.getGitInstallRoot(scope);
      if (gitRoot !== undefined && gitRoot !== "") {
        this.manager.git.paths.ensureGitIgnore(gitRoot);
      }
      mkdirSync(dirname(targetDir), { recursive: true });
      rmSync(this.manager.git.paths.getGitUpdateMarkerPath(targetDir), { force: true });

      try {
        yield* awaited(commandRunner.runCommand("git", ["clone", source.repo, targetDir]));
        if (source.ref !== undefined && source.ref !== "") {
          yield* awaited(
            commandRunner.runCommand("git", ["checkout", source.ref], { cwd: targetDir }),
          );
        }
        const packageJsonPath = join(targetDir, "package.json");
        if (existsSync(packageJsonPath)) {
          yield* performed(
            this.manager.npm.tool.runNpmCommand(
              this.manager.npm.tool.getGitDependencyInstallArgs(),
              { cwd: targetDir },
            ),
          );
        }
      } catch (error) {
        rmSync(targetDir, { force: true, recursive: true });
        this.manager.git.paths.pruneEmptyGitParents(targetDir, gitRoot);
        throw error;
      }
    }, this);
  }

  updateGit(source: gitTypes.GitSource, scope: packageManagerTypes.SourceScope): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const targetDir = this.manager.git.paths.getGitInstallPath(source, scope);
        if (!existsSync(targetDir)) {
          yield* performed(this.installGit(source, scope));
          return;
        }

        if (source.ref !== undefined && source.ref !== "") {
          yield* performed(
            this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD"),
          );
          return;
        }

        const target = yield* awaited(gitRemote.getLocalGitUpdateTarget(targetDir));
        yield* performed(this.ensureGitRef(targetDir, target.fetchArgs, target.ref));
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
