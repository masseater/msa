import frontmatterModule from "../utils/frontmatter.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type skillsInternalTypes from "./skills-internal.types.ts";
import type skillsTypes from "./skills.types.ts";
import sourceInfoModule from "./source-info.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { basename, dirname, join, relative, sep } = platformNode;
const { existsSync, readFileSync } = nodeFs;
const { createSyntheticSourceInfo } = sourceInfoModule;
const { parseFrontmatter } = frontmatterModule;

const MAX_NAME_LENGTH = 64;

const MAX_DESCRIPTION_LENGTH = 1024;

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

function validateName(name: string): string[] {
  const errors: string[] = [];

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/u.test(name)) {
    errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
  }

  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push(`name must not start or end with a hyphen`);
  }

  if (name.includes("--")) {
    errors.push(`name must not contain consecutive hyphens`);
  }

  return errors;
}

function validateDescription(description: unknown): string[] {
  const errors: string[] = [];

  if (typeof description !== "string" || description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}

function createSkillSourceInfo(
  filePath: string,
  baseDir: string,
  source: string,
): sourceInfoTypes.SourceInfo {
  switch (source) {
    case "user":
      return createSyntheticSourceInfo(filePath, {
        baseDir,
        scope: "user",
        source: "local",
      });
    case "project":
      return createSyntheticSourceInfo(filePath, {
        baseDir,
        scope: "project",
        source: "local",
      });
    case "path":
      return createSyntheticSourceInfo(filePath, {
        baseDir,
        source: "local",
      });
    default:
      return createSyntheticSourceInfo(filePath, { baseDir, source });
  }
}

function loadSkillFromFile(
  filePath: string,
  source: string,
): { skill: skillsTypes.Skill | null; diagnostics: diagnosticsTypes.ResourceDiagnostic[] } {
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  const isDeclaredSkill = basename(filePath) === "SKILL.md";

  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read skill file";
    diagnostics.push({ message, path: filePath, type: "warning" });
    return { diagnostics, skill: null };
  }

  let frontmatter: skillsTypes.SkillFrontmatter;
  try {
    ({ frontmatter } = parseFrontmatter<skillsTypes.SkillFrontmatter>(rawContent));
  } catch (error) {
    return loadSkillFromFilePart2(isDeclaredSkill, error, diagnostics, filePath);
  }

  const description = frontmatter.description;
  const hasDescription = typeof description === "string" && description.trim() !== "";
  if (!isDeclaredSkill && !hasDescription) {
    return { diagnostics, skill: null };
  }

  const { skillDir, name } = loadSkillFromFilePart1(
    filePath,
    description,
    diagnostics,
    frontmatter,
  );

  if (!hasDescription) {
    return { diagnostics, skill: null };
  }

  return {
    diagnostics,
    skill: {
      baseDir: skillDir,
      description,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
      filePath,
      name,
      sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
    },
  };
}

const skillsPart1 = {
  addIgnoreRules,
  loadSkillFromFile,
  toPosixPath,
};

export default skillsPart1;

function loadSkillFromFilePart2(
  isDeclaredSkill: boolean,
  error: unknown,
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
  filePath: string,
): { skill: skillsTypes.Skill | null; diagnostics: diagnosticsTypes.ResourceDiagnostic[] } {
  if (isDeclaredSkill) {
    const message = error instanceof Error ? error.message : "failed to parse skill file";
    diagnostics.push({ message, path: filePath, type: "warning" });
  }
  return { diagnostics, skill: null };
}

function loadSkillFromFilePart1(
  filePath: string,
  description: string | undefined,
  diagnostics: diagnosticsTypes.ResourceDiagnostic[],
  frontmatter: skillsTypes.SkillFrontmatter,
) {
  const skillDir = dirname(filePath);
  const parentDirName = basename(skillDir);

  const descErrors = validateDescription(description);
  for (const error of descErrors) {
    diagnostics.push({ message: error, path: filePath, type: "warning" });
  }

  const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
  const name = frontmatterName || parentDirName;

  const nameErrors = validateName(name);
  for (const error of nameErrors) {
    diagnostics.push({ message: error, path: filePath, type: "warning" });
  }
  return { name, skillDir };
}
