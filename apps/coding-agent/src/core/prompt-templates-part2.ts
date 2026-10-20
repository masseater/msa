import config from "../config.ts";
import paths from "../utils/paths.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformNode from "./platform-node.ts";
import nodeFs from "./platform/node/fs.ts";
import promptTemplatesPart1 from "./prompt-templates-part1.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import sourceInfoModule from "./source-info.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { dirname, join, resolve, sep } = platformNode;
const { createSyntheticSourceInfo } = sourceInfoModule;
const { existsSync, statSync } = nodeFs;
const { CONFIG_DIR_NAME } = config;
const { resolvePath } = paths;
const {
  loadPromptTemplatesPart9,
  loadTemplateFromFile,
  loadTemplatesFromDir,
  parseCommandArgs,
  substituteArgs,
} = promptTemplatesPart1;

function loadPromptTemplates(
  options: promptTemplatesTypes.LoadPromptTemplatesOptions,
): promptTemplatesTypes.LoadPromptTemplatesResult {
  const {
    templates,
    resolvedAgentDir,
    resolvedCwd,
    includeDefaults,
    promptPaths,
  }: {
    templates: promptTemplatesTypes.PromptTemplate[];
    resolvedAgentDir: string;
    resolvedCwd: string;
    includeDefaults: boolean;
    promptPaths: string[];
  } = loadPromptTemplatesPart11(options);
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  const addResult = (result: promptTemplatesTypes.LoadPromptTemplatesResult): void => {
    templates.push(...result.templates);
    diagnostics.push(...result.diagnostics);
  };

  const globalPromptsDir = join(resolvedAgentDir, "prompts");
  const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");

  const getSourceInfo = loadPromptTemplatesPart1(
    globalPromptsDir,
    projectPromptsDir,
    includeDefaults,
    addResult,
  );

  for (const rawPath of promptPaths) {
    const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
    if (!existsSync(resolvedPath)) {
      continue;
    }

    try {
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        addResult(loadTemplatesFromDir(resolvedPath, getSourceInfo));
      } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
        const result = loadTemplateFromFile(resolvedPath, getSourceInfo(resolvedPath));
        if (result.template !== null) {
          templates.push(result.template);
        }
        diagnostics.push(...result.diagnostics);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to read prompt template path";
      diagnostics.push({ message, path: resolvedPath, type: "warning" });
    }
  }

  return { diagnostics, templates };
}

function loadPromptTemplatesPart11(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
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

function loadPromptTemplatesPart2(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart10(options);
}

function loadPromptTemplatesPart10(options: promptTemplatesTypes.LoadPromptTemplatesOptions): {
  templates: promptTemplatesTypes.PromptTemplate[];
  resolvedAgentDir: string;
  resolvedCwd: string;
  includeDefaults: boolean;
  promptPaths: string[];
} {
  return loadPromptTemplatesPart9(options);
}

function loadPromptTemplatesPart1(
  globalPromptsDir: string,
  projectPromptsDir: string,
  includeDefaults: boolean,
  addResult: (result: promptTemplatesTypes.LoadPromptTemplatesResult) => void,
) {
  const isUnderPath = (target: string, root: string): boolean => {
    const normalizedRoot = resolve(root);
    if (target === normalizedRoot) {
      return true;
    }
    const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return target.startsWith(prefix);
  };

  const getSourceInfo = (resolvedPath: string): sourceInfoTypes.SourceInfo => {
    if (isUnderPath(resolvedPath, globalPromptsDir)) {
      return createSyntheticSourceInfo(resolvedPath, {
        baseDir: globalPromptsDir,
        scope: "user",
        source: "local",
      });
    }
    if (isUnderPath(resolvedPath, projectPromptsDir)) {
      return createSyntheticSourceInfo(resolvedPath, {
        baseDir: projectPromptsDir,
        scope: "project",
        source: "local",
      });
    }
    return createSyntheticSourceInfo(resolvedPath, {
      baseDir: statSync(resolvedPath).isDirectory() ? resolvedPath : dirname(resolvedPath),
      source: "local",
    });
  };

  if (includeDefaults) {
    addResult(loadTemplatesFromDir(globalPromptsDir, getSourceInfo));
    addResult(loadTemplatesFromDir(projectPromptsDir, getSourceInfo));
  }
  return getSourceInfo;
}

function expandPromptTemplate(
  text: string,
  templates: promptTemplatesTypes.PromptTemplate[],
): string {
  if (!text.startsWith("/")) return text;

  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/u);
  if (match === null) return text;

  const templateName = match[1];
  const argsString = match[2] ?? "";

  const template = templates.find((t) => t.name === templateName);
  if (template !== undefined) {
    const args = parseCommandArgs(argsString);
    return substituteArgs(template.content, args);
  }

  return text;
}

const promptTemplatesPart2 = {
  expandPromptTemplate,
  loadPromptTemplates,
};

export default promptTemplatesPart2;
