import * as Effect from "effect/Effect";

import text from "../../utils/text.ts";
import awaitingModule from "../awaiting.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import commandRunner from "./command-runner.ts";

const { join, resolve, sep } = platformNode;
const { existsSync, readFileSync, rmSync } = nodeFs;
const { stripBom } = text;
const { awaited, awaitingWith, performed } = awaitingModule;

export default class GitDependencies {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  private hasMissingGitDependencies(targetDir: string): boolean {
    const packageJsonPath = join(targetDir, "package.json");
    if (!existsSync(packageJsonPath)) return false;

    try {
      const manifest = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as {
        dependencies?: unknown;
      };
      if (
        typeof manifest.dependencies !== "object" ||
        manifest.dependencies === null ||
        Array.isArray(manifest.dependencies)
      ) {
        return false;
      }

      const nodeModulesDir = resolve(targetDir, "node_modules");
      return Object.keys(manifest.dependencies).some((name) => {
        const dependencyPath = resolve(nodeModulesDir, name);
        if (!dependencyPath.startsWith(`${nodeModulesDir}${sep}`)) return false;
        return !existsSync(dependencyPath);
      });
    } catch {
      return false;
    }
  }

  repairMissingGitDependencies(targetDir: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.hasMissingGitDependencies(targetDir)) return;
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
      if (existsSync(packageJsonPath)) {
        yield* performed(
          this.manager.npm.tool.runNpmCommand(this.manager.npm.tool.getGitDependencyInstallArgs(), {
            cwd: targetDir,
          }),
        );
      }
      rmSync(markerPath, { force: true });
    }, this);
  }
}
