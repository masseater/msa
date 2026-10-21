import frontmatterModule from "../utils/frontmatter.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import type skillsTypes from "./skills.types.ts";
import sourceInfoModule from "./source-info.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { basename, dirname } = platformModule;
const { parseFrontmatter } = frontmatterModule;
const { readFileSync } = nodeFs;
const { createSyntheticSourceInfo } = sourceInfoModule;

const MAX_NAME_LENGTH = 64;

const MAX_DESCRIPTION_LENGTH = 1024;

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
    return skillParseFailure(isDeclaredSkill, error, diagnostics, filePath);
  }

  const description = frontmatter.description;
  const hasDescription = typeof description === "string" && description.trim() !== "";
  if (!isDeclaredSkill && !hasDescription) {
    return { diagnostics, skill: null };
  }

  const { skillDir, name } = validateSkillIdentity(filePath, description, diagnostics, frontmatter);

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

function skillParseFailure(
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

function validateSkillIdentity(
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

const skillFile = { loadSkillFromFile };

export default skillFile;
