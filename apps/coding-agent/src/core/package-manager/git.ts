import type DefaultPackageManager from "../default-package-manager.ts";
import GitDependencies from "./git-dependencies.ts";
import GitInstalls from "./git-installs.ts";
import GitPaths from "./git-paths.ts";

export default class GitPackages {
  readonly paths: GitPaths;
  readonly installs: GitInstalls;
  readonly dependencies: GitDependencies;

  constructor(manager: DefaultPackageManager) {
    this.paths = new GitPaths(manager);
    this.installs = new GitInstalls(manager);
    this.dependencies = new GitDependencies(manager);
  }
}
