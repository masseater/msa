import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";

import AgentSessionLayer19 from "./agent-session-layer-19.ts";
import platform from "./platform.ts";
import systemPromptModule from "./system-prompt.ts";
import type systemPromptTypes from "./system-prompt.types.ts";

const { buildSystemPromptSections, diffSystemPromptSections } = systemPromptModule;
const { getCurrentSystemMessage } = ai;
const { nowMs } = platform;

export default abstract class AgentSessionLayer20 extends AgentSessionLayer19 {
  protected preparePromptAndToolLoadout(
    options: systemPromptTypes.NormalizedBuildSystemPromptOptions,
    messages: agentTypes.AgentMessage[] = this.agent.state.messages,
  ): compatTypes.SystemMessage | undefined {
    options.selectedTools = this.applyToolLoadout(options.selectedTools).map((tool) => tool.name);
    return this.promptUpdate(options, messages);
  }

  protected promptUpdate(
    options: systemPromptTypes.NormalizedBuildSystemPromptOptions,
    messages: agentTypes.AgentMessage[],
  ): compatTypes.SystemMessage | undefined {
    options.hiddenTools = [...this.hiddenDeclarations];
    const sections = diffSystemPromptSections(
      getCurrentSystemMessage(messages)?.sections ?? {},
      buildSystemPromptSections(options),
    );
    return sections === undefined
      ? undefined
      : { content: "", role: "system", sections, timestamp: nowMs() };
  }
}
