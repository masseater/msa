import type footerDataProviderTypes from "./footer-data-provider.types.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
const { existsSync, readFileSync, statSync } = nodeFs;
const { dirname, join, resolve } = platformModule;

function gitPathsFromFile(
  dir: string,
  gitPath: string,
): footerDataProviderTypes.GitPaths | null | undefined {
  const content = readFileSync(gitPath, "utf8").trim();
  if (!content.startsWith("gitdir: ")) return undefined;
  const gitDir = resolve(dir, content.slice(8).trim());
  const headPath = join(gitDir, "HEAD");
  if (!existsSync(headPath)) return null;
  const commonDirPath = join(gitDir, "commondir");
  const commonGitDir = existsSync(commonDirPath)
    ? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
    : gitDir;
  return { commonGitDir, headPath, repoDir: dir };
}

function gitPathsAt(dir: string): footerDataProviderTypes.GitPaths | null | undefined {
  const gitPath = join(dir, ".git");
  if (!existsSync(gitPath)) return undefined;
  try {
    const stat = statSync(gitPath);
    if (stat.isFile()) return gitPathsFromFile(dir, gitPath);
    if (!stat.isDirectory()) return undefined;
    const headPath = join(gitPath, "HEAD");
    if (!existsSync(headPath)) return null;
    return { commonGitDir: gitPath, headPath, repoDir: dir };
  } catch {
    return null;
  }
}

function findGitPaths(cwd: string): footerDataProviderTypes.GitPaths | null {
  let dir = cwd;
  while (true) {
    const found = gitPathsAt(dir);
    if (found !== undefined) return found;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const footerDataProviderSupport = {
  findGitPaths,
};

export default footerDataProviderSupport;
