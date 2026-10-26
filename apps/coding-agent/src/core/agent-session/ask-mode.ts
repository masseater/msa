import type agentTypes from "@msa/agent-core/index.types";

import type AgentSession from "../agent-session.ts";
import ask from "../ask.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type systemPromptTypes from "../system-prompt.types.ts";

const { askDefinition, ASK_SECTION_NAME, ASK_SECTION_TEXT } = ask;

export default class SessionAskMode {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  askRun = false;

  loadoutBeforeAsk: string[] = [];

  askVariants: Map<
    string,
    { tool: agentTypes.AgentTool; definition: extensionsTypes.ToolDefinition }
  > = new Map();

  askTool(name: string, tool: agentTypes.AgentTool): agentTypes.AgentTool[] {
    const definition = this.session.tools.registry.toolDefinitions.get(name)?.definition;
    const asked = definition === undefined ? undefined : askDefinition(definition);
    if (asked === undefined) return [];
    if (asked === definition) return [tool];
    const variant = this.askVariants.get(name)?.tool;
    return variant === undefined ? [] : [variant];
  }

  applyAskPrompt(options: systemPromptTypes.NormalizedBuildSystemPromptOptions): void {
    options.sections[ASK_SECTION_NAME] = ASK_SECTION_TEXT;
    if (options.forceSystemPrompt !== undefined) {
      options.forceSystemPrompt = `${options.forceSystemPrompt}\n\n${ASK_SECTION_TEXT}`;
    }
    const { prompt } = this.session.tools;
    const variants = [...this.askVariants].map(([name, { definition }]) => ({ definition, name }));
    options.toolSnippets = {
      ...options.toolSnippets,
      ...Object.fromEntries(
        variants.map(({ definition, name }) => [
          name,
          prompt.normalizePromptSnippet(definition.promptSnippet) ?? "",
        ]),
      ),
    };
    options.toolGuidelines = {
      ...options.toolGuidelines,
      ...Object.fromEntries(
        variants.map(({ definition, name }) => [
          name,
          prompt.normalizePromptGuidelines(definition.promptGuidelines),
        ]),
      ),
    };
  }

  endAskRun(): void {
    if (!this.askRun) return;
    this.askRun = false;
    this.session.tools.loadout.setActiveTools(this.loadoutBeforeAsk);
    this.loadoutBeforeAsk = [];
  }
}
