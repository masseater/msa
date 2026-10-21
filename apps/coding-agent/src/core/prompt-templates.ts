import config from "../config.ts";
import paths from "../utils/paths.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import platformModule from "./platform/index.ts";
import nodeFs from "./platform/node/fs.ts";
import promptTemplateArgs from "./prompt-template-args.ts";
import promptTemplateFiles from "./prompt-template-files.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import sourceInfoModule from "./source-info.ts";
import type sourceInfoTypes from "./source-info.types.ts";

const { dirname, join, resolve } = platformModule;
const { createSyntheticSourceInfo } = sourceInfoModule;
const { isPathWithin, resolvePath } = paths;
const { statSync, existsSync } = nodeFs;
const { CONFIG_DIR_NAME } = config;
const { substituteArgs, parseCommandArgs } = promptTemplateArgs;
const { loadTemplateFromFile, loadTemplatesFromDir } = promptTemplateFiles;

function loadPromptTemplates(
  options: promptTemplatesTypes.LoadPromptTemplatesOptions,
): promptTemplatesTypes.LoadPromptTemplatesResult {
  const resolvedCwd = resolvePath(options.cwd);
  const resolvedAgentDir = resolvePath(options.agentDir);
  const { includeDefaults, promptPaths } = options;
  const templates: promptTemplatesTypes.PromptTemplate[] = [];
  const diagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];
  const addResult = (result: promptTemplatesTypes.LoadPromptTemplatesResult): void => {
    templates.push(...result.templates);
    diagnostics.push(...result.diagnostics);
  };

  const globalPromptsDir = join(resolvedAgentDir, "prompts");
  const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");

  const getSourceInfo = loadDefaultTemplates(
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

function loadDefaultTemplates(
  globalPromptsDir: string,
  projectPromptsDir: string,
  includeDefaults: boolean,
  addResult: (result: promptTemplatesTypes.LoadPromptTemplatesResult) => void,
) {
  const getSourceInfo = (resolvedPath: string): sourceInfoTypes.SourceInfo => {
    if (isPathWithin(resolvedPath, globalPromptsDir)) {
      return createSyntheticSourceInfo(resolvedPath, {
        baseDir: globalPromptsDir,
        scope: "user",
        source: "local",
      });
    }
    if (isPathWithin(resolvedPath, projectPromptsDir)) {
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

const promptTemplates = { expandPromptTemplate, loadPromptTemplates };

export default promptTemplates;
