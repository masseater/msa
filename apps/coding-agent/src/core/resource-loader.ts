import chalk from "chalk";

import pathsModule from "../utils/paths.ts";
import text from "../utils/text.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";

const { existsSync, readFileSync, statSync } = nodeFs;
const { basename, dirname, join, sep } = platformNode;
const { stripBom } = text;
const { writeError } = platform;
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
function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
  const candidates = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
  for (const filename of candidates) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      try {
        if (!statSync(filePath).isFile()) {
          continue;
        }
        return {
          content: stripBom(readFileSync(filePath, "utf-8")),
          path: filePath,
        };
      } catch (error) {
        writeError(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
      }
    }
  }
  return null;
}
function findShadowedContextFile(cwd: string): string | undefined {
  const gitPaths = findGitPaths(cwd);
  if (gitPaths === null) return undefined;
  const commonGitDir = canonicalizePath(gitPaths.commonGitDir);
  const worktreeRoot = canonicalizePath(gitPaths.repoDir);
  const mainRepoRoot = dirname(commonGitDir);
  if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
  if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined;
  const worktreeContextFile = loadContextFileFromDir(worktreeRoot);
  return worktreeContextFile === null
    ? undefined
    : join(mainRepoRoot, basename(worktreeContextFile.path));
}
function loadProjectContextFiles(options: {
  cwd: string;
  agentDir: string;
}): Array<{ path: string; content: string }> {
  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(options.agentDir);

  const contextFiles: Array<{ path: string; content: string }> = [];
  const seenPaths = new Set<string>();

  const globalContext = loadContextFileFromDir(resolvedAgentDir);
  if (globalContext !== null) {
    contextFiles.push(globalContext);
    seenPaths.add(globalContext.path);
  }

  const ancestorContextFiles: Array<{ path: string; content: string }> = [];

  const shadowedContextFile = findShadowedContextFile(resolvedCwd);
  let currentDir = resolvedCwd;

  while (true) {
    const contextFile = loadContextFileFromDir(currentDir);
    const isShadowed =
      shadowedContextFile !== undefined &&
      contextFile !== null &&
      join(canonicalizePath(currentDir), basename(contextFile.path)) === shadowedContextFile;
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
}

const resourceLoader = {
  isBuiltinExtension,
  loadProjectContextFiles,
};

export default resourceLoader;
