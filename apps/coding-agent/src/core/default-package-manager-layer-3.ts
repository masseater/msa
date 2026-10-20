import * as Effect from "effect/Effect";
import { satisfies } from "semver";

import errors from "../utils/errors.ts";
import git from "../utils/git.ts";
import pathsModule from "../utils/paths.ts";
import awaitingModule from "./awaiting.ts";
import defaultPackageManagerHelpers from "./default-package-manager-helpers.ts";
import type defaultPackageManagerInternalTypes from "./default-package-manager-internal.types.ts";
import DefaultPackageManagerLayer2 from "./default-package-manager-layer-2.ts";
import type packageManagerTypes from "./package-manager.types.ts";

const { awaited, awaiting, awaitingWith } = awaitingModule;
const { toErrorMessage } = errors;
const { isLocalPath } = pathsModule;
const { parseGitUrl } = git;
const { getNpmVersionRange, isExactNpmVersion } = defaultPackageManagerHelpers;

export default abstract class DefaultPackageManagerLayer3 extends DefaultPackageManagerLayer2 {
  protected withProgress(
    action: packageManagerTypes.ProgressEvent["action"],
    source: string,
    message: string,
    operation: () => Promise<void>,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.emitProgress({ action, message, source, type: "start" });
      try {
        yield* awaited(operation());
        this.emitProgress({ action, source, type: "complete" });
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        this.emitProgress({ action, message: errorMessage, source, type: "error" });
        throw error;
      }
    }, this);
  }

  protected getSourceMatchKeyForInput(source: string): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    return `local:${this.resolvePath(parsed.path)}`;
  }

  protected getSourceMatchKeyForSettings(
    source: string,
    scope: packageManagerTypes.SourceScope,
  ): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    const baseDir = this.getBaseDirForScope(scope);
    return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
  }

  protected parseSource(source: string): defaultPackageManagerInternalTypes.ParsedSource {
    if (source.startsWith("npm:")) {
      const spec = source.slice("npm:".length).trim();
      const { name, version } = this.parseNpmSpec(spec);
      return {
        name,
        pinned: isExactNpmVersion(version),
        range: getNpmVersionRange(version),
        spec,
        type: "npm",
        version,
      };
    }

    if (isLocalPath(source)) {
      return { path: source, type: "local" };
    }

    const gitParsed = parseGitUrl(source);
    if (gitParsed !== null) {
      return gitParsed;
    }

    return { path: source, type: "local" };
  }

  protected installedNpmMatchesConfiguredVersion(
    source: defaultPackageManagerInternalTypes.NpmSource,
    installedPath: string,
  ): Effect.Effect<boolean> {
    return Effect.sync(() => {
      const installedVersion = this.getInstalledNpmVersion(installedPath);
      if (installedVersion === undefined || installedVersion === "") {
        return false;
      }
      return source.range !== undefined && source.range !== ""
        ? satisfies(installedVersion, source.range)
        : true;
    });
  }

  protected runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number,
  ): Effect.Effect<T[]> {
    return awaiting(function* () {
      if (tasks.length === 0) {
        return [];
      }

      const results: T[] = new Array(tasks.length);
      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(limit, tasks.length));

      const worker = () =>
        Effect.runPromise(
          awaiting(function* () {
            while (true) {
              const index = nextIndex;
              nextIndex += 1;
              const task = tasks[index];
              if (task === undefined) {
                return;
              }
              results[index] = yield* awaited(task());
            }
          }),
        );

      yield* awaited(Promise.all(Array.from({ length: workerCount }, () => worker())));
      return results;
    });
  }

  protected getPackageIdentity(source: string, scope?: packageManagerTypes.SourceScope): string {
    const parsed = this.parseSource(source);
    if (parsed.type === "npm") {
      return `npm:${parsed.name}`;
    }
    if (parsed.type === "git") {
      return `git:${parsed.host}/${parsed.path}`;
    }
    if (scope !== undefined) {
      const baseDir = this.getBaseDirForScope(scope);
      return `local:${this.resolvePathFromBase(parsed.path, baseDir)}`;
    }
    return `local:${this.resolvePath(parsed.path)}`;
  }
}
