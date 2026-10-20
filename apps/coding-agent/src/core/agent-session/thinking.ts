import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import defaultsModule from "../defaults.ts";

const { clampThinkingLevel, getSupportedThinkingLevels } = compat;
const { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } = defaultsModule;

export default class SessionThinking {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  supportsThinking(): boolean {
    return this.session.model?.reasoning === true;
  }

  getAvailableThinkingLevels(): agentTypes.ThinkingLevel[] {
    if (this.session.model === undefined) return [...THINKING_LEVEL_OPTIONS];
    return getSupportedThinkingLevels(this.session.model) as agentTypes.ThinkingLevel[];
  }

  getThinkingLevelForModelSwitch(
    targetModel?: compatTypes.Model<any>,
    explicitLevel?: agentTypes.ThinkingLevel,
  ): agentTypes.ThinkingLevel {
    if (explicitLevel !== undefined) {
      return explicitLevel;
    }
    if (targetModel !== undefined) {
      const perModel = this.session.settingsManager.getModelThinkingLevel(
        targetModel.provider,
        targetModel.id,
      );
      if (perModel !== undefined) {
        return perModel;
      }
    }
    return (
      this.session.settingsManager.getDefaultThinkingLevel() ??
      this.session.thinkingLevel ??
      DEFAULT_THINKING_LEVEL
    );
  }

  private clampThinkingLevel(
    level: agentTypes.ThinkingLevel,
    _availableLevels: agentTypes.ThinkingLevel[],
  ): agentTypes.ThinkingLevel {
    return this.session.model === undefined
      ? "off"
      : (clampThinkingLevel(this.session.model, level) as agentTypes.ThinkingLevel);
  }

  setThinkingLevel(
    level: agentTypes.ThinkingLevel,
    options: agentSessionTypes.ModelMutationOptions = {},
  ): void {
    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(level)
      ? level
      : this.clampThinkingLevel(level, availableLevels);

    const previousLevel = this.session.agent.state.thinkingLevel;
    const isChanging = effectiveLevel !== previousLevel;

    this.session.agent.state.thinkingLevel = effectiveLevel;

    if (options.persist === true) {
      this.session.settingsManager.setDefaultThinkingLevel(level);
    }

    if (isChanging) {
      this.session.sessionManager.appendThinkingLevelChange(effectiveLevel);
      this.session.emit({ level: effectiveLevel, type: "thinking_level_changed" });
      void this.session.extensions.binding.extensionRunnerInternal.emit({
        level: effectiveLevel,
        previousLevel,
        type: "thinking_level_select",
      });
    }
  }

  cycleThinkingLevel(
    options: agentSessionTypes.ModelMutationOptions = {},
  ): agentTypes.ThinkingLevel | undefined {
    if (!this.supportsThinking()) return undefined;

    const levels = this.getAvailableThinkingLevels();
    const currentIndex = levels.indexOf(this.session.thinkingLevel);
    const nextIndex = (currentIndex + 1) % levels.length;
    const nextLevel = levels[nextIndex];
    if (nextLevel === undefined) return undefined;

    this.setThinkingLevel(nextLevel, options);
    return nextLevel;
  }
}
