import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platform from "../platform/index.ts";

const { exists } = platform.files;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class PackageInstallation {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  remove(source: string, options?: { local?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const parsed = this.manager.sources.parseSource(source);
        const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
        this.manager.sources.assertProjectTrustedForScope(scope);
        yield* performed(
          this.manager.progress.withProgress("remove", source, `Removing ${source}...`, () =>
            Effect.runPromise(
              awaitingWith(function* () {
                if (parsed.type === "npm") {
                  yield* performed(this.manager.npm.installs.uninstallNpm(parsed, scope));
                  return;
                }
                if (parsed.type === "git") {
                  yield* performed(this.manager.git.installs.removeGit(parsed, scope));
                  return;
                }
                if (parsed.type === "local") {
                  return;
                }
                throw new Error(`Unsupported remove source: ${source}`);
              }, this),
            ),
          ),
        );
      }, this),
    );
  }

  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* awaited(this.remove(source, options));
        return this.manager.configured.removeSourceFromSettings(source, options);
      }, this),
    );
  }

  install(source: string, options?: { local?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const parsed = this.manager.sources.parseSource(source);
        const scope: packageManagerTypes.SourceScope = options?.local === true ? "project" : "user";
        this.manager.sources.assertProjectTrustedForScope(scope);
        yield* performed(
          this.manager.progress.withProgress("install", source, `Installing ${source}...`, () =>
            Effect.runPromise(
              awaitingWith(function* () {
                if (parsed.type === "npm") {
                  yield* performed(this.manager.npm.installs.installNpm(parsed, scope, false));
                  return;
                }
                if (parsed.type === "git") {
                  yield* performed(this.manager.git.installs.installGit(parsed, scope));
                  return;
                }
                if (parsed.type === "local") {
                  const resolved = this.manager.sources.resolvePath(parsed.path);
                  if (!(yield* awaited(exists(resolved)))) {
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
        this.manager.configured.addSourceToSettings(source, options);
      }, this),
    );
  }
}
