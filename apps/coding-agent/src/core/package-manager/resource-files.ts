import ignore from "ignore";

import awaitingModule from "../awaiting.ts";
import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import directoryEntry from "../directory-entry.ts";
import ignoreRules from "../ignore-rules.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformModule from "../platform/index.ts";

const { relative, resolve, sep } = platformModule;
const { exists, glob } = platformModule.files;
const { toPosixPath, addIgnoreRules } = ignoreRules;
const { awaited, promised } = awaitingModule;
const { readEntries, resolveEntry } = directoryEntry;

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

function expandPackageGlob(pattern: string, root: string): Promise<string[]> {
  return glob(pattern, root).then((matches) =>
    matches
      .map((match) => resolve(root, match))
      .filter((path) =>
        relative(root, path)
          .split(sep)
          .every((segment) => segment === ".." || !segment.startsWith(".")),
      )
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function collectFiles(
  dir: string,
  filePattern: RegExp,
  skipNodeModules = true,
  ignoreMatcher?: defaultPackageManagerInternalTypes.IgnoreMatcher,
  rootDir?: string,
): Promise<string[]> {
  return promised(function* () {
    const files: string[] = [];
    if (!(yield* awaited(exists(dir)))) return files;

    const root = rootDir ?? dir;
    const ig = ignoreMatcher ?? ignore();
    yield* awaited(addIgnoreRules(ig, dir, root));

    try {
      for (const entry of yield* awaited(readEntries(dir))) {
        if (entry.name.startsWith(".")) continue;
        if (skipNodeModules && entry.name === "node_modules") continue;
        const resolved = yield* awaited(resolveEntry(dir, entry));
        if (resolved === undefined) continue;
        const { fullPath, isDir, isFile } = resolved;
        const relPath = toPosixPath(relative(root, fullPath));
        if (ig.ignores(isDir ? `${relPath}/` : relPath)) continue;

        if (isDir) {
          files.push(
            ...(yield* awaited(collectFiles(fullPath, filePattern, skipNodeModules, ig, root))),
          );
        } else if (isFile && filePattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {}

    return files;
  });
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
