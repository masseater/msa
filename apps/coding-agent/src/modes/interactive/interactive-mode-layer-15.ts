import type agentTypes from "@msa/agent-core/index.types";
import tuiModule from "@msa/tui";

import agentSessionHelpers from "../../core/agent-session-helpers.ts";
import defaults from "../../core/defaults.ts";
import type truncateTypes from "../../core/tools/truncate.types.ts";
import BashExecutionComponent from "./components/bash-execution.ts";
import SkillInvocationMessageComponent from "./components/skill-invocation-message.ts";
import ThinkingSelectorComponent from "./components/thinking-selector.ts";
import InteractiveModeLayer14 from "./interactive-mode-layer-14.ts";

const { Spacer } = tuiModule;
const { parseSkillBlock } = agentSessionHelpers;
const { DEFAULT_THINKING_LEVEL } = defaults;

export default abstract class InteractiveModeLayer15 extends InteractiveModeLayer14 {
  protected addBashExecutionToChat(
    message: Extract<agentTypes.AgentMessage, { role: "bashExecution" }>,
  ): void {
    const component = new BashExecutionComponent(
      message.command,
      this.ui,
      message.excludeFromContext,
      this.outputPad,
    );
    if (message.output !== "") component.appendOutput(message.output);
    component.setComplete(
      message.exitCode,
      message.cancelled,
      message.truncated ? ({ truncated: true } as truncateTypes.TruncationResult) : undefined,
      message.fullOutputPath,
    );
    this.chatContainer.addChild(component);
  }

  protected addUserMessageToChat(
    message: Extract<agentTypes.AgentMessage, { role: "user" }>,
    options: { populateHistory?: boolean } | undefined,
  ): void {
    const textContent = this.getUserMessageText(message);
    if (textContent === "") return;
    if (this.chatContainer.children.length > 0) this.chatContainer.addChild(new Spacer(1));
    const skillBlock = parseSkillBlock(textContent);
    if (skillBlock === null) this.addUserComponent(textContent);
    else {
      const component = new SkillInvocationMessageComponent(
        skillBlock,
        this.getMarkdownThemeWithSettings(),
        this.outputPad,
      );
      component.setExpanded(this.toolOutputExpanded);
      this.chatContainer.addChild(component);
      if (skillBlock.userMessage !== undefined && skillBlock.userMessage !== "") {
        this.chatContainer.addChild(new Spacer(1));
        this.addUserComponent(skillBlock.userMessage);
      }
    }
    if (options?.populateHistory === true) this.editor.addToHistory?.(textContent);
  }

  protected handleThinkingCommand(searchTerm?: string): void {
    const availableLevels = this.session.models.thinking.getAvailableThinkingLevels();
    if (searchTerm === undefined || searchTerm === "") {
      this.showThinkingSelector();
      return;
    }

    const normalized = searchTerm.trim().toLowerCase();
    const level = availableLevels.find((candidate) => candidate.toLowerCase() === normalized);
    if (level === undefined) {
      this.showError(
        `Unknown thinking level "${searchTerm}". Available levels: ${availableLevels.join(", ")}.`,
      );
      return;
    }

    this.selectThinkingLevel(level, false);
  }

  protected showThinkingSelector(): void {
    this.editorSlot.showSelector((done) => {
      const selectLevel = (level: agentTypes.ThinkingLevel, persist: boolean) => {
        this.selectThinkingLevel(level, persist);
        done();
      };
      const selector = new ThinkingSelectorComponent(
        this.session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        this.session.models.thinking.getAvailableThinkingLevels(),
        (level) => selectLevel(level, false),
        () => {
          done();
          this.ui.requestRender();
        },
        (level) => selectLevel(level, true),
        this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      );
      return { component: selector, focus: selector };
    });
  }
}
