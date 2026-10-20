import type agentTypes from "@msa/agent-core/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import AssistantMessageComponent from "../components/assistant-message.ts";
import BranchSummaryMessageComponent from "../components/branch-summary-message.ts";
import CompactionSummaryMessageComponent from "../components/compaction-summary-message.ts";
import mermaid from "../components/mermaid.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";
const { createMermaidMarkdownTransformer } = mermaid;
const { theme, getMarkdownTheme } = themeModule;
const { Spacer } = tuiModule;

export default class ChatMessages {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private readonly mermaidMarkdownTransformer: extensionsTypes.MarkdownTransformer =
    createMermaidMarkdownTransformer({
      getMode: () => this.mode.settingsManager.getMermaidRenderingMode(),
      theme,
    });

  getMarkdownTransformers(): extensionsTypes.MarkdownTransformer[] {
    return [
      this.mermaidMarkdownTransformer,
      ...this.mode.session.extensions.binding.extensionRunner.getMarkdownTransformers(),
    ];
  }

  getMarkdownThemeWithSettings(): tuiTypes.MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.mode.settingsManager.getCodeBlockIndent(),
    };
  }

  private addSummaryToChat(
    component: { setExpanded(expanded: boolean): void } & tuiTypes.Component,
  ): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    component.setExpanded(this.mode.display.resources.toolOutputExpanded);
    this.mode.layout.chatContainer.addChild(component);
  }

  addMessageToChat(
    message: agentTypes.AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    const markdown = () => this.getMarkdownThemeWithSettings();
    switch (message.role) {
      case "bashExecution":
        return this.mode.view.userMessages.addBashExecutionToChat(message);
      case "custom":
        return this.mode.view.customMessages.addCustomMessageToChat(message);
      case "compactionSummary":
        return this.addSummaryToChat(
          new CompactionSummaryMessageComponent(
            message,
            markdown(),
            this.mode.display.thinking.outputPad,
          ),
        );
      case "branchSummary":
        return this.addSummaryToChat(
          new BranchSummaryMessageComponent(
            message,
            markdown(),
            this.mode.display.thinking.outputPad,
          ),
        );
      case "user":
        return this.mode.view.userMessages.addUserMessageToChat(message, options);
      case "assistant":
        return this.mode.layout.chatContainer.addChild(
          new AssistantMessageComponent(
            message,
            this.mode.display.thinking.hideThinkingBlock,
            markdown(),
            this.mode.display.thinking.hiddenThinkingLabel,
            this.mode.display.thinking.outputPad,
            this.getMarkdownTransformers(),
          ),
        );
      case "system":
      case "toolResult":
        return undefined;
      default:
        message satisfies never;
    }
  }
}
