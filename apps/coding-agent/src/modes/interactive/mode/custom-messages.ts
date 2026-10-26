import type agentTypes from "@msa/agent-core/index.types";

import type extensionsTypes from "../../../core/extensions/index.types.ts";
import orchestratorSupport from "../../../core/orchestrator/orchestrator-support.ts";
import CustomMessageComponent from "../components/custom-message.ts";
import tasksViewHelpers from "../components/tasks-view-helpers.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { createTaskReportRenderer } = tasksViewHelpers;
const { ORCHESTRATOR_REPORT_MESSAGE_TYPE } = orchestratorSupport;

export default class CustomMessagesView {
  private readonly mode: InteractiveMode;

  private readonly components = new WeakMap<object, CustomMessageComponent>();

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  addCustomMessageToChat(message: Extract<agentTypes.AgentMessage, { role: "custom" }>): void {
    if (!message.display) return;
    const renderer =
      message.customType === ORCHESTRATOR_REPORT_MESSAGE_TYPE
        ? (createTaskReportRenderer(
            this.mode.session.integrations.orchestration.orchestrator,
          ) as extensionsTypes.MessageRenderer)
        : this.mode.session.extensions.binding.extensionRunner.getMessageRenderer(
            message.customType,
          );
    const component = new CustomMessageComponent(
      message,
      renderer,
      this.mode.view.messages.getMarkdownThemeWithSettings(),
      this.mode.display.thinking.outputPad,
    );
    component.setExpanded(this.mode.display.resources.toolOutputExpanded);
    this.components.set(message, component);
    this.mode.layout.chatContainer.addChild(component);
  }

  replaceCustomMessage(
    shown: Extract<agentTypes.AgentMessage, { role: "custom" }>,
    replacement: Extract<agentTypes.AgentMessage, { role: "custom" }>,
  ): void {
    const component = this.components.get(shown);
    if (component === undefined || shown === replacement) return;
    this.components.delete(shown);
    this.components.set(replacement, component);
    component.setMessage(replacement);
  }
}
