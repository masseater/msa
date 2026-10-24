import ai from "@msa/ai";

import config from "../config.ts";
import developmentStyle from "./development-style.ts";
import platform from "./platform/index.ts";
import skillsModule from "./skills.ts";
import type skillsTypes from "./skills.types.ts";
import type systemPromptTypes from "./system-prompt.types.ts";

const { getDocsPath, getExamplesPath, getReadmePath } = config;
const { formatSkillsForPrompt } = skillsModule;

const { getSystemMessageText } = ai;
const { DEVELOPMENT_STYLE } = developmentStyle;
const { localTimeZone } = platform;

const FILE_OPERATION_RULES = {
  bash: "Use bash for file operations like ls, rg, find",
  bashAndPowerShell:
    "Use bash or PowerShell for file operations like listing, searching, and finding files",
  powershell: "Use PowerShell for file operations like listing, searching, and finding files",
} as const;

function timeZoneSection(): string {
  const { name, offset } = localTimeZone();
  return [
    `The user's time zone is ${name} (UTC${offset}).`,
    "Write every date and time you show the user in this time zone, as YYYY-MM-DD HH:MM, and never in UTC.",
    "Tools and logs often print UTC timestamps (ending in Z or +00:00); convert them before you quote them.",
  ].join("\n");
}

const ORCHESTRATOR_PREAMBLE =
  "You are an expert coding assistant operating inside msa, a coding agent harness. You work as an orchestrator: you break the request into tasks with create_task, give each one the state it starts from and the state it must reach, record what it depends on, and steer the threads that carry them out. You do not implement the tasks yourself; you read their reports, replan, and tell the user what the tasks produced.";

const CODING_PREAMBLE =
  "You are an expert coding assistant operating inside msa, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/u;
function normalizeBuildSystemPromptOptions(
  input: systemPromptTypes.BuildSystemPromptOptions,
): systemPromptTypes.NormalizedBuildSystemPromptOptions {
  return {
    appendSystemPrompt: input.appendSystemPrompt ?? "",
    contextFiles: (input.contextFiles ?? []).map((file) => Object.assign({}, file)),
    customPrompt: input.customPrompt,
    cwd: input.cwd,
    forceSystemPrompt: input.forceSystemPrompt,
    hiddenTools: [...(input.hiddenTools ?? [])],
    promptGuidelines: [...(input.promptGuidelines ?? [])],
    sections: { ...(input.sections ?? {}) },
    selectedTools: [...(input.selectedTools ?? ["read", "bash", "edit", "write"])],
    skills: (input.skills ?? []).map((skill) => Object.assign({}, skill)),
    toolGuidelines: Object.fromEntries(
      Object.entries(input.toolGuidelines ?? {}).map(([name, guidelines]) => [
        name,
        [...guidelines],
      ]),
    ),
    toolSnippets: { ...(input.toolSnippets ?? {}) },
  };
}

function renderProjectContext(contextFiles: Array<{ path: string; content: string }>): string {
  return [
    "Project-specific instructions and guidelines:",
    ...contextFiles.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
}

function buildRules(
  selectedTools: string[],
  toolGuidelines: Record<string, string[]>,
  promptGuidelines: string[],
): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  const addRule = (rule: string): void => {
    const normalized = rule.trim();
    if (normalized === "" || seen.has(normalized)) return;
    seen.add(normalized);
    rules.push(normalized);
  };

  const hasBash = selectedTools.includes("bash");
  const hasPowerShell = selectedTools.includes("powershell");
  const hasGrep = selectedTools.includes("grep");
  const hasFind = selectedTools.includes("find");
  const hasLs = selectedTools.includes("ls");

  if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
    addRule(
      FILE_OPERATION_RULES[
        hasBash && hasPowerShell ? "bashAndPowerShell" : hasPowerShell ? "powershell" : "bash"
      ],
    );
  }

  for (const name of selectedTools) {
    for (const rule of toolGuidelines[name] ?? []) addRule(rule);
  }
  for (const rule of promptGuidelines) addRule(rule);
  addRule("Be concise in your responses");
  addRule("Show file paths clearly when working with files");
  return rules.map((rule) => `- ${rule}`).join("\n");
}

function buildSystemPromptSections(
  input: systemPromptTypes.BuildSystemPromptOptions,
): systemPromptTypes.SystemPromptSections {
  const options = normalizeBuildSystemPromptOptions(input);
  const {
    customPrompt,
    selectedTools,
    hiddenTools,
    toolSnippets,
    toolGuidelines,
    promptGuidelines,
    appendSystemPrompt,
    sections: customSections,
    cwd,
    contextFiles,
    skills,
  } = options;

  for (const name of Object.keys(customSections)) {
    if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
      throw new Error(`Invalid system prompt section name: ${name}`);
    }
  }

  const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
  const promptSections: Record<string, string> = {};
  const sections: systemPromptTypes.SystemPromptSections = fillPromptSections(
    customPrompt,
    promptSections,
    declaredTools,
    toolSnippets,
    toolGuidelines,
    promptGuidelines,
    appendSystemPrompt,
    contextFiles,
    selectedTools,
    skills,
    cwd,
    customSections,
  );
  for (const [name, content] of Object.entries(promptSections)) {
    if (name !== "preamble") sections[name] = `<${name}>\n${content}\n</${name}>`;
  }
  return sections;
}

const docsSection = (): string =>
  `msa documentation (read only when the user asks about msa itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading msa docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), msa packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), long-term memory (docs/memory.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on msa topics, read the docs and examples, and follow .md cross-references before implementing
- Always read msa .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

function addDefaultSections(
  promptSections: Record<string, string>,
  declaredTools: string[],
  toolSnippets: Record<string, string>,
  guidelines: { toolGuidelines: Record<string, string[]>; promptGuidelines: string[] },
): void {
  const visibleTools = declaredTools.filter(
    (name) => !(toolSnippets[name] === undefined || toolSnippets[name] === ""),
  );
  const tools =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
      : "(none)";
  promptSections["tools"] =
    `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
  promptSections["rules"] = buildRules(
    declaredTools,
    guidelines.toolGuidelines,
    guidelines.promptGuidelines,
  );
  promptSections["docs"] = docsSection();
}

function fillPromptSections(
  customPrompt: string | undefined,
  promptSections: Record<string, string>,
  declaredTools: string[],
  toolSnippets: Record<string, string>,
  toolGuidelines: Record<string, string[]>,
  promptGuidelines: string[],
  appendSystemPrompt: string,
  contextFiles: { path: string; content: string }[] & { path: string; content: string }[],
  selectedTools: string[],
  skills: skillsTypes.Skill[],
  cwd: string,
  customSections: Record<string, string>,
) {
  const hasCustomPrompt = customPrompt !== undefined && customPrompt !== "";
  const preamble = hasCustomPrompt
    ? customPrompt
    : declaredTools.includes("create_task")
      ? ORCHESTRATOR_PREAMBLE
      : CODING_PREAMBLE;
  promptSections["preamble"] = preamble;
  if (!hasCustomPrompt) {
    addDefaultSections(promptSections, declaredTools, toolSnippets, {
      promptGuidelines,
      toolGuidelines,
    });
  }
  promptSections["development_style"] = DEVELOPMENT_STYLE;

  if (appendSystemPrompt !== "") promptSections["addendum"] = appendSystemPrompt;
  fillContextSections(
    contextFiles,
    promptSections,
    declaredTools,
    selectedTools,
    skills,
    cwd,
    customSections,
  );

  const sections: systemPromptTypes.SystemPromptSections = { preamble };
  return sections;
}

function fillContextSections(
  contextFiles: { path: string; content: string }[] & { path: string; content: string }[],
  promptSections: Record<string, string>,
  declaredTools: string[],
  selectedTools: string[],
  skills: skillsTypes.Skill[],
  cwd: string,
  customSections: Record<string, string>,
) {
  if (contextFiles.length > 0)
    promptSections["project_context"] = renderProjectContext(contextFiles);
  const readers = ["read", "bash"] as const;
  const skillFileReadTool =
    readers.find((tool) => declaredTools.includes(tool)) ??
    (readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
  if (skillFileReadTool !== undefined && skills.length > 0) {
    const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
    if (skillsPrompt !== "") promptSections["skills"] = skillsPrompt;
  }
  promptSections["cwd"] = cwd.replace(/\\/gu, "/");
  promptSections["timezone"] = timeZoneSection();
  for (const [name, content] of Object.entries(customSections)) {
    if (content !== "") promptSections[name] = content;
  }
}

function buildSystemPromptState(input: systemPromptTypes.BuildSystemPromptOptions): {
  content: string;
  sections?: systemPromptTypes.SystemPromptSections;
} {
  if (input.forceSystemPrompt !== undefined) return { content: input.forceSystemPrompt };
  return { content: "", sections: buildSystemPromptSections(input) };
}

function buildSystemPrompt(input: systemPromptTypes.BuildSystemPromptOptions): string {
  return getSystemMessageText({ role: "system", ...buildSystemPromptState(input), timestamp: 0 });
}

function diffSystemPromptSections(
  previous: Record<string, string | null>,
  current: systemPromptTypes.SystemPromptSections,
): Record<string, string | null> | undefined {
  const patch: Record<string, string | null> = {};
  for (const [name, text] of Object.entries(current)) {
    if (previous[name] !== text) patch[name] = text;
  }
  for (const name of Object.keys(previous)) {
    if (current[name] === undefined) patch[name] = null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

const systemPrompt = {
  FILE_OPERATION_RULES,
  ORCHESTRATOR_PREAMBLE,
  buildSystemPrompt,
  buildSystemPromptSections,
  buildSystemPromptState,
  diffSystemPromptSections,
  normalizeBuildSystemPromptOptions,
};

export default systemPrompt;
