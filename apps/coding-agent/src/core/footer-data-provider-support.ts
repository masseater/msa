import type footerDataProviderTypes from "./footer-data-provider.types.ts";
import platformModule from "./platform/index.ts";

const { dirname, join, resolve } = platformModule;
const { exists, readText, stat } = platformModule.files;

type FoundGitPaths = footerDataProviderTypes.GitPaths | null | undefined;

function commonGitDirOf(gitDir: string): Promise<string> {
  const commonDirPath = join(gitDir, "commondir");
  return readText(commonDirPath).then(
    (content) => resolve(gitDir, content.trim()),
    () => gitDir,
  );
}

function gitPathsFromFile(dir: string, gitPath: string): Promise<FoundGitPaths> {
  return readText(gitPath).then((raw) => {
    const content = raw.trim();
    if (!content.startsWith("gitdir: ")) return undefined;
    const gitDir = resolve(dir, content.slice(8).trim());
    const headPath = join(gitDir, "HEAD");
    return exists(headPath).then((found) =>
      found
        ? commonGitDirOf(gitDir).then((commonGitDir) => ({ commonGitDir, headPath, repoDir: dir }))
        : null,
    );
  });
}

function gitPathsFromDirectory(dir: string, gitPath: string): Promise<FoundGitPaths> {
  const headPath = join(gitPath, "HEAD");
  return exists(headPath).then((found) =>
    found ? { commonGitDir: gitPath, headPath, repoDir: dir } : null,
  );
}

function gitPathsAt(dir: string): Promise<FoundGitPaths> {
  const gitPath = join(dir, ".git");
  return stat(gitPath).then(
    (info) => {
      if (info.isFile) return gitPathsFromFile(dir, gitPath).catch(() => null);
      return info.isDirectory ? gitPathsFromDirectory(dir, gitPath) : undefined;
    },
    () => undefined,
  );
}

function findGitPaths(cwd: string): Promise<footerDataProviderTypes.GitPaths | null> {
  return gitPathsAt(cwd).then((found) => {
    if (found !== undefined) return found;
    const parent = dirname(cwd);
    return parent === cwd ? null : findGitPaths(parent);
  });
}

const footerDataProviderSupport = {
  findGitPaths,
};

export default footerDataProviderSupport;
