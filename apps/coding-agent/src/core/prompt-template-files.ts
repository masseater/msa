import frontmatterModule from "../utils/frontmatter.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import directoryEntry from "./directory-entry.ts";
import platformModule from "./platform/index.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { basename } = platformModule;
const { exists, readText } = platformModule.files;
const { readEntries, resolveEntry } = directoryEntry;
const { parseFrontmatter } = frontmatterModule;

type TemplateFileResult = {
  template: promptTemplatesTypes.PromptTemplate | null;
  diagnostics: diagnosticsTypes.ResourceDiagnostic[];
};

function loadTemplateFromFile(
  filePath: string,
  sourceInfo: sourceInfoTypes.SourceInfo,
): Promise<TemplateFileResult> {
  return readText(filePath).then(
    (rawContent) => templateFromContent(filePath, sourceInfo, rawContent),
    (error: unknown) => ({
      diagnostics: [
        {
          message: error instanceof Error ? error.message : "failed to read prompt template file",
          path: filePath,
          type: "warning" as const,
        },
      ],
      template: null,
    }),
  );
}

function templateFromContent(
  filePath: string,
  sourceInfo: sourceInfoTypes.SourceInfo,
  rawContent: string,
): TemplateFileResult {
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

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
): Promise<promptTemplatesTypes.LoadPromptTemplatesResult> {
  const result: promptTemplatesTypes.LoadPromptTemplatesResult = { diagnostics: [], templates: [] };
  return exists(dir)
    .then((found) => (found ? readEntries(dir) : []))
    .then((entries) =>
      Promise.all(
        entries
          .filter((entry) => entry.name.endsWith(".md"))
          .map((entry) => resolveEntry(dir, entry)),
      ),
    )
    .then((resolved) =>
      Promise.all(
        resolved
          .filter((entry) => entry?.isFile === true)
          .map((entry) => loadTemplateFromFile(entry!.fullPath, getSourceInfo(entry!.fullPath))),
      ),
    )
    .then((loaded) => {
      for (const file of loaded) {
        if (file.template !== null) result.templates.push(file.template);
        result.diagnostics.push(...file.diagnostics);
      }
      return result;
    })
    .catch(() => result);
}

const promptTemplateFiles = { loadTemplateFromFile, loadTemplatesFromDir };

export default promptTemplateFiles;
