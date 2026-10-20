import * as Effect from "effect/Effect";

import type gitTypes from "../utils/git.types.ts";
import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer8 from "./default-package-manager-layer-8.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { existsSync, mkdirSync, rmSync } = nodeFs;
const { dirname, join } = platformNode;
const { GIT_UPDATE_CONCURRENCY, UPDATE_CHECK_CONCURRENCY, isOfflineModeEnabled } =
  defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer9 extends DefaultPackageManagerLayer8 {
  install(source: string, options?: { local?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const parsed = this.parseSource(source);
        const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
        this.assertProjectTrustedForScope(scope);
        yield* performed(
          this.withProgress("install", source, `Installing ${source}...`, () =>
            Effect.runPromise(
              awaitingWith(function* () {
                if (parsed.type === "npm") {
                  yield* performed(this.installNpm(parsed, scope, false));
                  return;
                }
                if (parsed.type === "git") {
                  yield* performed(this.installGit(parsed, scope));
                  return;
                }
                if (parsed.type === "local") {
                  const resolved = this.resolvePath(parsed.path);
                  if (!existsSync(resolved)) {
                    throw new Error(`Path does not exist: ${resolved}`);
                  }
                  return;
                }
                throw new Error(`Unsupported install source: ${source}`);
              }, this),
            ),
          ),
        );
      }, this),
    );
  }

  installAndPersist(source: string, options?: { local?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.install(source, options));
        this.addSourceToSettings(source, options);
      }, this),
    );
  }

  protected updateConfiguredSources(
    sources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[],
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (isOfflineModeEnabled() || sources.length === 0) {
        return;
      }

      const npmCandidates: defaultPackageManagerInternalTypes.NpmUpdateTarget[] = [];
      const gitCandidates: defaultPackageManagerInternalTypes.GitUpdateTarget[] = [];

      const {
        userNpmUpdates,
        projectNpmUpdates,
      }: {
        userNpmUpdates: defaultPackageManagerInternalTypes.NpmUpdateTarget[];
        projectNpmUpdates: defaultPackageManagerInternalTypes.NpmUpdateTarget[];
      } = yield* this.updateConfiguredSourcesPart1(sources, npmCandidates, gitCandidates);

      const tasks: Promise<void>[] = [];
      if (userNpmUpdates.length > 0) {
        tasks.push(Effect.runPromise(this.updateNpmBatch(userNpmUpdates, "user")));
      }
      if (projectNpmUpdates.length > 0) {
        tasks.push(Effect.runPromise(this.updateNpmBatch(projectNpmUpdates, "project")));
      }
      if (gitCandidates.length > 0) {
        const gitTasks = gitCandidates.map(
          (entry) => () =>
            Effect.runPromise(
              awaitingWith(function* () {
                return yield* performed(
                  this.withProgress("update", entry.source, `Updating ${entry.source}...`, () =>
                    Effect.runPromise(
                      awaitingWith(function* () {
                        yield* awaited(this.updateGit(entry.parsed, entry.scope));
                      }, this),
                    ),
                  ),
                );
              }, this),
            ),
        );
        tasks.push(
          Effect.runPromise(this.runWithConcurrency(gitTasks, GIT_UPDATE_CONCURRENCY)).then(
            () => undefined,
          ),
        );
      }

      yield* awaited(Promise.all(tasks));
    }, this);
  }

  private *updateConfiguredSourcesPart1(
    sources: defaultPackageManagerInternalTypes.ConfiguredUpdateSource[],
    npmCandidates: defaultPackageManagerInternalTypes.NpmUpdateTarget[],
    gitCandidates: defaultPackageManagerInternalTypes.GitUpdateTarget[],
  ) {
    for (const entry of sources) {
      const parsed = this.parseSource(entry.source);
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
              shouldUpdate: yield* performed(this.shouldUpdateNpmSource(entry.parsed, entry.scope)),
            };
          }, this),
        ),
    );
    const npmCheckResults = yield* performed(
      this.runWithConcurrency(npmCheckTasks, UPDATE_CHECK_CONCURRENCY),
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

  protected installParsedSource(
    parsed: defaultPackageManagerInternalTypes.ParsedSource,
    scope: packageManagerTypes.SourceScope,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (parsed.type === "npm") {
          yield* performed(this.installNpm(parsed, scope, scope === "temporary"));
        } else if (parsed.type === "git") {
          yield* performed(this.installGit(parsed, scope));
        }
      }, this),
    );
  }

  protected installGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const targetDir = this.getGitInstallPath(source, scope);
      if (existsSync(targetDir)) {
        if (source.ref !== undefined && source.ref !== "") {
          yield* performed(
            this.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD"),
          );
          return;
        }
        const target = yield* awaited(this.getLocalGitUpdateTarget(targetDir));
        yield* performed(this.ensureGitRef(targetDir, target.fetchArgs, target.ref));
        return;
      }
      const gitRoot = this.getGitInstallRoot(scope);
      if (gitRoot !== undefined && gitRoot !== "") {
        this.ensureGitIgnore(gitRoot);
      }
      mkdirSync(dirname(targetDir), { recursive: true });
      rmSync(this.getGitUpdateMarkerPath(targetDir), { force: true });

      try {
        yield* awaited(this.runCommand("git", ["clone", source.repo, targetDir]));
        if (source.ref !== undefined && source.ref !== "") {
          yield* awaited(this.runCommand("git", ["checkout", source.ref], { cwd: targetDir }));
        }
        const packageJsonPath = join(targetDir, "package.json");
        if (existsSync(packageJsonPath)) {
          yield* performed(
            this.runNpmCommand(this.getGitDependencyInstallArgs(), { cwd: targetDir }),
          );
        }
      } catch (error) {
        rmSync(targetDir, { force: true, recursive: true });
        this.pruneEmptyGitParents(targetDir, gitRoot);
        throw error;
      }
    }, this);
  }

  protected updateGit(
    source: gitTypes.GitSource,
    scope: packageManagerTypes.SourceScope,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const targetDir = this.getGitInstallPath(source, scope);
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

        const target = yield* awaited(this.getLocalGitUpdateTarget(targetDir));
        yield* performed(this.ensureGitRef(targetDir, target.fetchArgs, target.ref));
      }, this),
    );
  }

  protected refreshTemporaryGitSource(
    source: gitTypes.GitSource,
    sourceStr: string,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isOfflineModeEnabled()) {
          return;
        }
        try {
          yield* performed(
            this.withProgress("pull", sourceStr, `Refreshing ${sourceStr}...`, () =>
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
