import platformModule from "./platform/index.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";

const { join, relative, sep } = platformModule;
const { readText } = platformModule.files;

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

const ignorePatterns = (content: string, prefix: string): string[] =>
  content
    .split(/\r?\n/u)
    .map((line) => prefixIgnorePattern(line, prefix))
    .filter((line): line is string => Boolean(line));

function addIgnoreRules(
  ig: skillsInternalTypes.IgnoreMatcher,
  dir: string,
  rootDir: string,
): Promise<void> {
  const relativeDir = relative(rootDir, dir);
  const prefix = relativeDir === "" ? "" : `${toPosixPath(relativeDir)}/`;
  return Promise.all(
    IGNORE_FILE_NAMES.map((filename) =>
      readText(join(dir, filename)).then(
        (content) => ignorePatterns(content, prefix),
        () => [],
      ),
    ),
  ).then((groups) => {
    for (const patterns of groups) if (patterns.length > 0) ig.add(patterns);
    return undefined;
  });
}

const ignoreRules = { addIgnoreRules, toPosixPath };

export default ignoreRules;
