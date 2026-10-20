import frontmatterModule from "../utils/frontmatter.ts";
import paths from "../utils/paths.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { existsSync, readFileSync, readdirSync, statSync } = nodeFs;
const { parseFrontmatter } = frontmatterModule;
const { basename, join } = platformNode;
const { resolvePath } = paths;

function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let hasToken = false;
  let inQuote: string | null = null;

  for (const char of argsString) {
    if (inQuote !== null && inQuote !== "") {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasToken = true;
    } else if (/\s/u.test(char)) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }

  if (hasToken) {
    args.push(current);
  }

  return args;
}

function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");

  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/gu,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget !== undefined) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[parseInt(defaultTarget, 10) - 1];
        return value !== undefined && value !== "" ? value : defaultValue;
      }

      if (sliceStart !== undefined) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;

        if (sliceLength !== undefined) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }

      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }

      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

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
  description = loadTemplateFromFilePart1(description, body);

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

function loadTemplateFromFilePart1(description: string, body: string) {
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

function loadPromptTemplatesPart9(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart8(options);
}

function loadPromptTemplatesPart8(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart7(options);
}

function loadPromptTemplatesPart7(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart6(options);
}

function loadPromptTemplatesPart6(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart5(options);
}

function loadPromptTemplatesPart5(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart4(options);
}

function loadPromptTemplatesPart4(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart3(options);
}

function loadPromptTemplatesPart3(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart2(options);
}

function loadPromptTemplatesPart2(options: promptTemplatesTypes.LoadPromptTemplatesOptions) {
  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(options.agentDir);
  const promptPaths = options.promptPaths;
  const includeDefaults = options.includeDefaults;

  const templates: promptTemplatesTypes.PromptTemplate[] = [];
  return { includeDefaults, promptPaths, resolvedAgentDir, resolvedCwd, templates };
}

const promptTemplatesPart1 = {
  loadPromptTemplatesPart9,
  loadTemplateFromFile,
  loadTemplatesFromDir,
  parseCommandArgs,
  substituteArgs,
};

export default promptTemplatesPart1;
