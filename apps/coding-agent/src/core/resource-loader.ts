import chalk from "chalk";

import pathsModule from "../utils/paths.ts";
import text from "../utils/text.ts";
import awaitingModule from "./awaiting.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";
import platform from "./platform/index.ts";

const { basename, dirname, join, sep, writeError } = platform;
const { readText, stat } = platform.files;
const { awaited, promised } = awaitingModule;
const { stripBom } = text;
const { findGitPaths } = footerDataProviderSupport;
const { canonicalizePath, resolvePath } = pathsModule;
type BuiltinExtension = Exclude<
  extensionsTypesTypes.InlineExtension,
  extensionsTypesTypes.ExtensionFactory
>;
function isBuiltinExtension(
  input: extensionsTypesTypes.InlineExtension,
): input is BuiltinExtension {
  return typeof input !== "function" && input.builtin === true;
}
type ContextFile = { path: string; content: string };

const CONTEXT_FILE_NAMES = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];

function readContextFile(filePath: string): Promise<ContextFile | null> {
  return stat(filePath).then(
    (info) =>
      info.isFile
        ? readText(filePath).then(
            (content) => ({ content: stripBom(content), path: filePath }),
            (error: unknown) => {
              writeError(chalk.yellow(`Warning: Could not read ${filePath}: ${String(error)}`));
              return null;
            },
          )
        : null,
    () => null,
  );
}

function loadContextFileFromDir(dir: string): Promise<ContextFile | null> {
  return promised(function* () {
    for (const filename of CONTEXT_FILE_NAMES) {
      const contextFile = yield* awaited(readContextFile(join(dir, filename)));
      if (contextFile !== null) return contextFile;
    }
    return null;
  });
}

function findShadowedContextFile(cwd: string): Promise<string | undefined> {
  return promised(function* () {
    const gitPaths = yield* awaited(findGitPaths(cwd));
    if (gitPaths === null) return undefined;
    const commonGitDir = yield* awaited(canonicalizePath(gitPaths.commonGitDir));
    const worktreeRoot = yield* awaited(canonicalizePath(gitPaths.repoDir));
    const mainRepoRoot = dirname(commonGitDir);
    if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
    if ((yield* awaited(canonicalizePath(join(mainRepoRoot, ".git")))) !== commonGitDir)
      return undefined;
    const worktreeContextFile = yield* awaited(loadContextFileFromDir(worktreeRoot));
    return worktreeContextFile === null
      ? undefined
      : join(mainRepoRoot, basename(worktreeContextFile.path));
  });
}

function loadProjectContextFiles(options: {
  cwd: string;
  agentDir: string;
}): Promise<ContextFile[]> {
  return promised(function* () {
    const resolvedCwd = resolvePath(options.cwd);
    const resolvedAgentDir = resolvePath(options.agentDir);

    const contextFiles: ContextFile[] = [];
    const seenPaths = new Set<string>();

    const globalContext = yield* awaited(loadContextFileFromDir(resolvedAgentDir));
    if (globalContext !== null) {
      contextFiles.push(globalContext);
      seenPaths.add(globalContext.path);
    }

    const ancestorContextFiles: ContextFile[] = [];
    const shadowedContextFile = yield* awaited(findShadowedContextFile(resolvedCwd));
    let currentDir = resolvedCwd;

    while (true) {
      const contextFile = yield* awaited(loadContextFileFromDir(currentDir));
      const isShadowed =
        shadowedContextFile !== undefined &&
        contextFile !== null &&
        join(yield* awaited(canonicalizePath(currentDir)), basename(contextFile.path)) ===
          shadowedContextFile;
      if (contextFile !== null && !isShadowed && !seenPaths.has(contextFile.path)) {
        ancestorContextFiles.unshift(contextFile);
        seenPaths.add(contextFile.path);
      }

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    contextFiles.push(...ancestorContextFiles);
    return contextFiles;
  });
}

const resourceLoader = {
  isBuiltinExtension,
  loadProjectContextFiles,
};

export default resourceLoader;
