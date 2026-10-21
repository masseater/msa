import config from "../../config.ts";
import type gitTypes from "../../utils/git.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";

const { basename, dirname, join, resolve } = platformModule;
const { exists, makeDirectory, readDirectory, remove, writeFile } = platformModule.files;
const { CONFIG_DIR_NAME } = config;

const removeIfEmpty = (dir: string): Promise<boolean> =>
  readDirectory(dir).then((entries) =>
    entries.length > 0
      ? false
      : remove({ force: true, path: dir, recursive: true }).then(
          () => true,
          () => false,
        ),
  );

const pruneEmptyParents = (current: string, resolvedRoot: string): Promise<void> => {
  if (!current.startsWith(resolvedRoot) || current === resolvedRoot) return Promise.resolve();
  return exists(current)
    .then((found) => (found ? removeIfEmpty(current) : true))
    .then((continueUp) =>
      continueUp ? pruneEmptyParents(dirname(current), resolvedRoot) : undefined,
    );
};

export default class GitPaths {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getGitUpdateMarkerPath(targetDir: string): string {
    return join(dirname(targetDir), `.${basename(targetDir)}.msa-update-incomplete`);
  }

  pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): Promise<void> {
    if (installRoot === undefined || installRoot === "") return Promise.resolve();
    return pruneEmptyParents(dirname(targetDir), resolve(installRoot));
  }

  ensureGitIgnore(dir: string): Promise<void> {
    const ignorePath = join(dir, ".gitignore");
    return makeDirectory({ path: dir })
      .then(() => exists(ignorePath))
      .then((found) =>
        found ? undefined : writeFile({ data: "*\n!.gitignore\n", path: ignorePath }),
      );
  }

  getGitInstallRoot(scope: packageManagerTypes.SourceScope): string | undefined {
    if (scope === "temporary") {
      return undefined;
    }
    if (scope === "project") {
      this.manager.sources.assertProjectTrustedForScope(scope);
      return join(this.manager.cwd, CONFIG_DIR_NAME, "git");
    }
    return join(this.manager.agentDir, "git");
  }

  getGitInstallPath(source: gitTypes.GitSource, scope: packageManagerTypes.SourceScope): string {
    if (scope === "temporary") {
      return this.manager.sources.getTemporaryDir(`git-${source.host}`, source.path, source.ref);
    }
    const installRoot = this.getGitInstallRoot(scope);
    if (installRoot === undefined || installRoot === "") {
      throw new Error("Missing git install root");
    }
    return this.manager.sources.resolveManagedPath(installRoot, source.host, source.path);
  }
}
