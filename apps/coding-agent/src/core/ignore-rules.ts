import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";

const { readFileSync, existsSync } = nodeFs;
const { join, relative, sep } = platformNode;

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

function addIgnoreRules(ig: skillsInternalTypes.IgnoreMatcher, dir: string, rootDir: string): void {
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

const ignoreRules = { addIgnoreRules, toPosixPath };

export default ignoreRules;
