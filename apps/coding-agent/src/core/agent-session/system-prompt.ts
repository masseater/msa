import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionInternalTypes from "../agent-session-internal.types.ts";
import type AgentSession from "../agent-session.ts";
import platform from "../platform/index.ts";
import systemPromptModule from "../system-prompt.ts";
import type systemPromptTypes from "../system-prompt.types.ts";

const {
  buildSystemPrompt,
  normalizeBuildSystemPromptOptions,
  buildSystemPromptSections,
  diffSystemPromptSections,
} = systemPromptModule;
const { nowMs } = platform;
const { getCurrentSystemMessage } = ai;

export default class SessionSystemPrompt {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private toolPromptSnippets: Map<string, string> = new Map();

  toolPromptGuidelines: Map<string, string[]> = new Map();

  baseSystemPromptOptions!: systemPromptTypes.NormalizedBuildSystemPromptOptions;

  runSystemPromptOptions?: systemPromptTypes.NormalizedBuildSystemPromptOptions | undefined;

  normalizePromptSnippet(text: string | undefined): string | undefined {
    if (text === undefined || text === "") return undefined;
    const oneLine = text
      .replace(/[\r\n]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return oneLine.length > 0 ? oneLine : undefined;
  }

  normalizePromptGuidelines(guidelines: string[] | undefined): string[] {
    if (guidelines === undefined || guidelines.length === 0) {
      return [];
    }

    const unique = new Set<string>();
    for (const guideline of guidelines) {
      const normalized = guideline.trim();
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    return Array.from(unique);
  }

  get systemPrompt(): string {
    return buildSystemPrompt(this.runSystemPromptOptions ?? this.baseSystemPromptOptions);
  }

  rebuildSystemPrompt(toolNames: string[]): void {
    const validToolNames = toolNames.filter((name) =>
      this.session.tools.registry.toolRegistry.has(name),
    );
    const toolSnippets = Object.fromEntries(
      [...this.session.tools.registry.toolRegistry.keys()].flatMap((name) => {
        const snippet = this.toolPromptSnippets.get(name);
        return snippet === undefined || snippet === "" ? [] : [[name, snippet] as const];
      }),
    );

    const loaderSystemPrompt = this.session.resourceLoader.getSystemPrompt();
    const loaderAppendSystemPrompt = this.session.resourceLoader.getAppendSystemPrompt();
    const appendSystemPrompt =
      loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : "";
    const loadedSkills = this.session.resourceLoader.getSkills().skills;
    const loadedContextFiles = this.session.resourceLoader.getAgentsFiles().agentsFiles;

    this.baseSystemPromptOptions = normalizeBuildSystemPromptOptions({
      appendSystemPrompt,
      contextFiles: loadedContextFiles,
      customPrompt: loaderSystemPrompt,
      cwd: this.session.cwd,
      hiddenTools: [...this.session.tools.loadout.hiddenDeclarations],
      selectedTools: validToolNames,
      skills: loadedSkills,
      toolGuidelines: Object.fromEntries(this.toolPromptGuidelines),
      toolSnippets,
    });
  }

  indexToolPrompts(
    definitionRegistry: Map<string, agentSessionInternalTypes.ToolDefinitionEntry>,
  ): void {
    const definitions = Array.from(definitionRegistry.values(), ({ definition }) => definition);
    this.toolPromptSnippets = new Map(
      definitions.flatMap((definition) => {
        const snippet = this.normalizePromptSnippet(definition.promptSnippet);
        return snippet !== undefined && snippet !== "" ? [[definition.name, snippet] as const] : [];
      }),
    );
    this.toolPromptGuidelines = new Map(
      definitions.flatMap((definition) => {
        const guidelines = this.normalizePromptGuidelines(definition.promptGuidelines);
        return guidelines.length > 0 ? [[definition.name, guidelines] as const] : [];
      }),
    );
  }

  nextTurnPromptOptions(): systemPromptTypes.NormalizedBuildSystemPromptOptions {
    const runOptions = this.runSystemPromptOptions ?? this.baseSystemPromptOptions;
    return normalizeBuildSystemPromptOptions({
      ...runOptions,
      selectedTools: this.session.tools.loadout.getActiveToolNames(),
      toolGuidelines: {
        ...this.baseSystemPromptOptions.toolGuidelines,
        ...runOptions.toolGuidelines,
      },
      toolSnippets: { ...this.baseSystemPromptOptions.toolSnippets, ...runOptions.toolSnippets },
    });
  }

  promptUpdate(
    options: systemPromptTypes.NormalizedBuildSystemPromptOptions,
    messages: agentTypes.AgentMessage[],
  ): compatTypes.SystemMessage | undefined {
    options.hiddenTools = [...this.session.tools.loadout.hiddenDeclarations];
    const sections = diffSystemPromptSections(
      getCurrentSystemMessage(messages)?.sections ?? {},
      buildSystemPromptSections(options),
    );
    return sections === undefined
      ? undefined
      : { content: "", role: "system", sections, timestamp: nowMs() };
  }
}
