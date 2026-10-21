import ignore from "ignore";

import type defaultPackageManagerInternalTypes from "../default-package-manager-internal.types.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import platformNode from "../platform-node.ts";
import nodeFs from "../platform/node/fs.ts";
import resourceEntries from "./resource-entries.ts";

const { statSync, readdirSync, globSync, readFileSync, existsSync } = nodeFs;
const { resolve, join, relative, sep } = platformNode;
const { collectAutoExtensionEntries, collectSkillEntries } = resourceEntries;

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

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

function toPosixPath(p: string): string {
  return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

  let pattern = line;
  let negated = false;

  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith("\\!")) {
    pattern = pattern.slice(1);
  }

  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }

  const prefixed = prefix === "" ? pattern : `${prefix}${pattern}`;
  return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(
  ig: defaultPackageManagerInternalTypes.IgnoreMatcher,
  dir: string,
  rootDir: string,
): void {
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir === "" ? "" : `${toPosixPath(relativeDir)}/`;

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = join(dir, filename);
    if (!existsSync(ignorePath)) continue;
    try {
      const content = readFileSync(ignorePath, "utf-8");
      const patterns = content
        .split(/\r?\n/u)
        .map((line) => prefixIgnorePattern(line, prefix))
        .filter((line): line is string => Boolean(line));
      if (patterns.length > 0) {
        ig.add(patterns);
      }
    } catch {}
  }
}

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

function collectResourceFiles(
  dir: string,
  resourceType: defaultPackageManagerInternalTypes.ResourceType,
): string[] {
  if (resourceType === "skills") {
    return collectSkillEntries(dir, "msa");
  }
  if (resourceType === "extensions") {
    return collectAutoExtensionEntries(dir);
  }
  return collectFiles(dir, FILE_PATTERNS[resourceType]);
}

function resourcePrecedenceRank(m: packageManagerTypes.PathMetadata): number {
  if (m.source === "builtin") return 5;
  if (m.origin === "package") return 4;
  const scopeBase = m.scope === "project" ? 0 : 2;
  return scopeBase + (m.source === "local" ? 0 : 1);
}

const resourceFiles = {
  RESOURCE_TYPES,
  addIgnoreRules,
  collectResourceFiles,
  expandPackageGlob,
  resourcePrecedenceRank,
  toPosixPath,
};

export default resourceFiles;
