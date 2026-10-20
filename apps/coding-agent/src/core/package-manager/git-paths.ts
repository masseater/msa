import config from "../../config.ts";
import type gitTypes from "../../utils/git.types.ts";
import type DefaultPackageManager from "../default-package-manager.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";

const { basename, dirname, join, resolve } = platformNode;
const { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = nodeFs;
const { CONFIG_DIR_NAME } = config;

export default class GitPaths {
  private readonly manager: DefaultPackageManager;

  constructor(manager: DefaultPackageManager) {
    this.manager = manager;
  }

  getGitUpdateMarkerPath(targetDir: string): string {
    return join(dirname(targetDir), `.${basename(targetDir)}.msa-update-incomplete`);
  }

  pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): void {
    if (installRoot === undefined || installRoot === "") return;
    const resolvedRoot = resolve(installRoot);
    let current = dirname(targetDir);
    while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
      if (!existsSync(current)) {
        current = dirname(current);
        continue;
      }
      const entries = readdirSync(current);
      if (entries.length > 0) {
        break;
      }
      try {
        rmSync(current, { force: true, recursive: true });
      } catch {
        break;
      }
      current = dirname(current);
    }
  }

  ensureGitIgnore(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const ignorePath = join(dir, ".gitignore");
    if (!existsSync(ignorePath)) {
      writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
    }
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
