import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import tuiModule from "@msa/tui";

import agentSessionHelpers from "../../../core/agent-session-helpers.ts";
import type truncateTypes from "../../../core/tools/truncate.types.ts";
import BashExecutionComponent from "../components/bash-execution.ts";
import SkillInvocationMessageComponent from "../components/skill-invocation-message.ts";
import UserMessageComponent from "../components/user-message.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { Spacer } = tuiModule;
const { parseSkillBlock } = agentSessionHelpers;

export default class UserMessagesView {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private getUserMessageText(message: compatTypes.Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ text: message.content, type: "text" }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  private addUserComponent(text: string): void {
    this.mode.layout.chatContainer.addChild(
      new UserMessageComponent(
        text,
        this.mode.view.messages.getMarkdownThemeWithSettings(),
        this.mode.display.thinking.outputPad,
        this.mode.view.messages.getMarkdownTransformers(),
      ),
    );
  }

  addBashExecutionToChat(
    message: Extract<agentTypes.AgentMessage, { role: "bashExecution" }>,
  ): void {
    const component = new BashExecutionComponent(
      message.command,
      this.mode.ui,
      message.excludeFromContext,
      this.mode.display.thinking.outputPad,
    );
    if (message.output !== "") component.appendOutput(message.output);
    component.setComplete(
      message.exitCode,
      message.cancelled,
      message.truncated ? ({ truncated: true } as truncateTypes.TruncationResult) : undefined,
      message.fullOutputPath,
    );
    this.mode.layout.chatContainer.addChild(component);
  }

  addUserMessageToChat(
    message: Extract<agentTypes.AgentMessage, { role: "user" }>,
    options: { populateHistory?: boolean } | undefined,
  ): void {
    const textContent = this.getUserMessageText(message);
    if (textContent === "") return;
    if (this.mode.layout.chatContainer.children.length > 0)
      this.mode.layout.chatContainer.addChild(new Spacer(1));
    const skillBlock = parseSkillBlock(textContent);
    if (skillBlock === null) this.addUserComponent(textContent);
    else {
      const component = new SkillInvocationMessageComponent(
        skillBlock,
        this.mode.view.messages.getMarkdownThemeWithSettings(),
        this.mode.display.thinking.outputPad,
      );
      component.setExpanded(this.mode.display.resources.toolOutputExpanded);
      this.mode.layout.chatContainer.addChild(component);
      if (skillBlock.userMessage !== undefined && skillBlock.userMessage !== "") {
        this.mode.layout.chatContainer.addChild(new Spacer(1));
        this.addUserComponent(skillBlock.userMessage);
      }
    }
    if (options?.populateHistory === true) this.mode.editor.addToHistory?.(textContent);
  }
}
