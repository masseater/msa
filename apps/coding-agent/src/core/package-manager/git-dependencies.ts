import * as Effect from "effect/Effect";

import text from "../../utils/text.ts";
import awaitingModule from "../awaiting.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import platformModule from "../platform/index.ts";
import commandRunner from "./command-runner.ts";

const { join, resolve, sep } = platformModule;
const { exists, readText, remove } = platformModule.files;
const { stripBom } = text;
const { awaited, awaitingWith, performed } = awaitingModule;

const dependencyNames = (content: string): string[] => {
  const manifest = JSON.parse(stripBom(content)) as { dependencies?: unknown };
  const { dependencies } = manifest;
  return typeof dependencies === "object" && dependencies !== null && !Array.isArray(dependencies)
    ? Object.keys(dependencies)
    : [];
};

const anyDependencyMissing = (nodeModulesDir: string, names: string[]): Promise<boolean> =>
  Promise.all(
    names
      .map((name) => resolve(nodeModulesDir, name))
      .filter((dependencyPath) => dependencyPath.startsWith(`${nodeModulesDir}${sep}`))
      .map((dependencyPath) => exists(dependencyPath)),
  ).then((found) => found.some((present) => !present));

export default class GitDependencies {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  private hasMissingGitDependencies(targetDir: string): Promise<boolean> {
    const packageJsonPath = join(targetDir, "package.json");
    return exists(packageJsonPath)
      .then((found) => (found ? readText(packageJsonPath).then(dependencyNames) : []))
      .then((names) => anyDependencyMissing(resolve(targetDir, "node_modules"), names))
      .catch(() => false);
  }

  repairMissingGitDependencies(targetDir: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!(yield* awaited(this.hasMissingGitDependencies(targetDir)))) return;
      yield* performed(
        this.manager.npm.tool.runNpmCommand(this.manager.npm.tool.getGitDependencyInstallArgs(), {
          cwd: targetDir,
        }),
      );
    }, this);
  }

  cleanAndInstallGitDependencies(targetDir: string, markerPath: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        yield* awaited(commandRunner.runCommand("git", ["clean", "-fdx"], { cwd: targetDir }));
      } catch (error) {
        yield* awaited(
          Effect.runPromise(this.repairMissingGitDependencies(targetDir)).catch(() => {}),
        );
        throw error;
      }

      const packageJsonPath = join(targetDir, "package.json");
      if (yield* awaited(exists(packageJsonPath))) {
        yield* performed(
          this.manager.npm.tool.runNpmCommand(this.manager.npm.tool.getGitDependencyInstallArgs(), {
            cwd: targetDir,
          }),
        );
      }
      yield* awaited(remove({ force: true, path: markerPath }));
    }, this);
  }
}
