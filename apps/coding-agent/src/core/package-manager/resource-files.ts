import ignore from "ignore";

import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import ignoreRules from "../ignore-rules.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";

const { statSync, readdirSync, existsSync, globSync } = nodeFs;
const { join, sep, relative, resolve } = platformNode;
const { toPosixPath, addIgnoreRules } = ignoreRules;

const RESOURCE_TYPES: defaultPackageManagerInternalTypes.ResourceType[] = [
  "extensions",
  "skills",
  "prompts",
  "themes",
];

const FILE_PATTERNS: Record<defaultPackageManagerInternalTypes.ResourceType, RegExp> = {
  extensions: /\.(ts|js)$/u,
  prompts: /\.md$/u,
  skills: /\.md$/u,
  themes: /\.json$/u,
};

function expandPackageGlob(pattern: string, root: string): string[] {
  return globSync(pattern, { cwd: root })
    .map((match) => resolve(root, match))
    .filter((path) =>
      relative(root, path)
        .split(sep)
        .every((segment) => segment === ".." || !segment.startsWith(".")),
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function collectFiles(
  dir: string,
  filePattern: RegExp,
  skipNodeModules = true,
  ignoreMatcher?: defaultPackageManagerInternalTypes.IgnoreMatcher,
  rootDir?: string,
): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (skipNodeModules && entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const relPath = toPosixPath(relative(root, fullPath));
      const ignorePath = isDir ? `${relPath}/` : relPath;
      if (ig.ignores(ignorePath)) continue;

      if (isDir) {
        files.push(...collectFiles(fullPath, filePattern, skipNodeModules, ig, root));
      } else if (isFile && filePattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch {}

  return files;
}

function resourcePrecedenceRank(m: packageManagerTypes.PathMetadata): number {
  if (m.source === "builtin") return 5;
  if (m.origin === "package") return 4;
  const scopeBase = m.scope === "project" ? 0 : 2;
  return scopeBase + (m.source === "local" ? 0 : 1);
}

const resourceFiles = {
  FILE_PATTERNS,
  RESOURCE_TYPES,
  collectFiles,
  expandPackageGlob,
  resourcePrecedenceRank,
};

export default resourceFiles;
