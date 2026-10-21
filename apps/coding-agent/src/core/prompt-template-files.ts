import frontmatterModule from "../utils/frontmatter.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { statSync, readdirSync, existsSync, readFileSync } = nodeFs;
const { basename, join } = platformModule;
const { parseFrontmatter } = frontmatterModule;

function loadTemplateFromFile(
  filePath: string,
  sourceInfo: sourceInfoTypes.SourceInfo,
): {
  template: promptTemplatesTypes.PromptTemplate | null;
  diagnostics: diagnosticsTypes.ResourceDiagnostic[];
} {
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to read prompt template file";
    diagnostics.push({ message, path: filePath, type: "warning" });
    return { diagnostics, template: null };
  }

  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    ({ frontmatter, body } = parseFrontmatter(rawContent));
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to parse prompt template file";
    diagnostics.push({ message, path: filePath, type: "warning" });
    return { diagnostics, template: null };
  }

  const name = basename(filePath).replace(/\.md$/u, "");

  let description =
    typeof frontmatter["description"] === "string" ? frontmatter["description"] : "";
  description = describeTemplate(description, body);

  const argumentHint =
    typeof frontmatter["argument-hint"] === "string" ? frontmatter["argument-hint"] : undefined;
  return {
    diagnostics,
    template: {
      description,
      name,
      ...(argumentHint && { argumentHint }),
      content: body,
      filePath,
      sourceInfo,
    },
  };
}

function describeTemplate(description: string, body: string) {
  if (description === "") {
    const firstLine = body.split("\n").find((line) => line.trim());
    if (firstLine !== undefined && firstLine !== "") {
      description = firstLine.slice(0, 60);
      if (firstLine.length > 60) description += "...";
    }
  }
  return description;
}

function loadTemplatesFromDir(
  dir: string,
  getSourceInfo: (filePath: string) => sourceInfoTypes.SourceInfo,
): promptTemplatesTypes.LoadPromptTemplatesResult {
  const templates: promptTemplatesTypes.PromptTemplate[] = [];
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  if (!existsSync(dir)) {
    return { diagnostics, templates };
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath);
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      if (isFile && entry.name.endsWith(".md")) {
        const result = loadTemplateFromFile(fullPath, getSourceInfo(fullPath));
        if (result.template !== null) {
          templates.push(result.template);
        }
        diagnostics.push(...result.diagnostics);
      }
    }
  } catch {
    return { diagnostics, templates };
  }

  return { diagnostics, templates };
}

const promptTemplateFiles = { loadTemplateFromFile, loadTemplatesFromDir };

export default promptTemplateFiles;
