import type compatTypes from "@msa/ai/compat.types";

import config from "../../config.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import slashCommandsModule from "../../core/slash-commands.ts";
import renderers from "../../core/tools/renderers/index.ts";
import imageConvert from "../../utils/image-convert.ts";
import shell from "../../utils/shell.ts";
import InteractiveModeLayer3 from "./interactive-mode-layer-3.ts";
import loadedResources from "./loaded-resources.ts";

const { getStartupVisibility } = loadedResources;
const { ensurePngTranscoder } = imageConvert;
const { APP_NAME } = config;
const { withBuiltInRenderers } = renderers;
const { killTrackedDetachedChildren } = shell;
const { slashCommandName } = slashCommandsModule;

export default abstract class InteractiveModeLayer4 extends InteractiveModeLayer3 {
  protected isStartupExpanded(): boolean {
    return this.options.verbose === true || this.toolOutputExpanded;
  }

  protected getStartupVisibility(): { header: boolean; details: boolean } {
    return getStartupVisibility(
      this.settingsManager.getQuietStartup(),
      this.options.verbose === true,
    );
  }

  protected applyFullscreenScrollbarSetting(): void {
    this.transcriptScrollView?.setScrollbar(this.settingsManager.getFullscreenScrollbar());
  }

  protected ensurePngTranscoder(): void {
    ensurePngTranscoder(() => {
      this.ui.invalidate();
      this.ui.requestRender();
    });
  }

  protected crashReportInstructions(): string {
    const resume =
      this.session.sessionFile !== undefined && this.session.sessionFile !== ""
        ? `run \`${APP_NAME} -r\` to resume the session, then`
        : "start msa and";
    return `To report this crash: ${resume} run /bug. The crash details are attached automatically.`;
  }

  protected getRegisteredToolDefinition(toolName: string) {
    return this.session.extensionRunner.resolveToolRenderers(toolName, () =>
      withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName)),
    );
  }

  protected getMarkdownTransformers(): extensionsTypes.MarkdownTransformer[] {
    return [
      this.mermaidMarkdownTransformer,
      ...this.session.extensionRunner.getMarkdownTransformers(),
    ];
  }

  protected setExtensionStatus(key: string, text: string | undefined): void {
    this.footerDataProvider.setExtensionStatus(key, text);
    this.ui.requestRender();
  }

  protected setWorkingIndicator(options?: extensionsTypes.WorkingIndicatorOptions): void {
    this.workingIndicatorOptions = options;
    if (this.activeStatusIndicator?.kind === "working") {
      this.activeStatusIndicator.setIndicator(options);
    }
    this.ui.requestRender();
  }

  protected addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const subscription = { handler, unsubscribe: this.ui.addInputListener(handler) };
    this.extensionTerminalInputSubscriptions.add(subscription);
    return () => {
      subscription.unsubscribe();
      this.extensionTerminalInputSubscriptions.delete(subscription);
    };
  }

  protected rebindExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) {
      subscription.unsubscribe();
      subscription.unsubscribe = this.ui.addInputListener(subscription.handler);
    }
  }

  protected clearExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) subscription.unsubscribe();
    this.extensionTerminalInputSubscriptions.clear();
  }

  protected setWorkingMessageFromExtension(message: string | undefined): void {
    this.workingMessage = message;
    if (this.activeStatusIndicator?.kind === "working")
      this.activeStatusIndicator.setMessage(message ?? this.defaultWorkingMessage);
  }

  protected onAgentStart(): void {
    this.pendingTools.clear();
    if (this.retryEscapeHandler === undefined) return;
    this.defaultEditor.onEscape = this.retryEscapeHandler;
    this.retryEscapeHandler = undefined;
  }

  protected getUserMessageText(message: compatTypes.Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ text: message.content, type: "text" }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  protected emergencyTerminalExit(): never {
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    killTrackedDetachedChildren();
    process.exit(129);
  }

  protected unregisterSignalHandlers(): void {
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
  }

  clearEditor(): void {
    this.editor.setText("");
    this.ui.requestRender();
  }

  protected getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      followUp: [
        ...this.session.getFollowUpMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "followUp")
          .map((msg) => msg.text),
      ],
      steering: [
        ...this.session.getSteeringMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => msg.text),
      ],
    };
  }

  protected clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.session.clearQueue();
    const compactionSteering = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.compactionQueuedMessages = [];
    return {
      followUp: [...followUp, ...compactionFollowUp],
      steering: [...steering, ...compactionSteering],
    };
  }

  protected isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.session.extensionRunner;

    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return extensionRunner.getCommand(commandName) !== undefined;
  }

  protected flushPendingBashComponents(): void {
    for (const component of this.pendingBashComponents) {
      this.pendingMessagesContainer.removeChild(component);
      this.chatContainer.addChild(component);
    }
    this.pendingBashComponents = [];
  }

  protected showSettingsSelectorSelector(): {
    defaultModel: string;
  } {
    const defaultProvider = this.settingsManager.getDefaultProvider();
    const defaultModelId = this.settingsManager.getDefaultModel();
    const defaultModel =
      defaultProvider !== undefined &&
      defaultProvider !== "" &&
      defaultModelId !== undefined &&
      defaultModelId !== ""
        ? `${defaultProvider}/${defaultModelId}`
        : "not set";
    return { defaultModel };
  }

  protected updateAvailableProviderCount(): void {
    const models =
      this.session.scopedModels.length > 0
        ? this.session.scopedModels.map((scoped) => scoped.model)
        : this.session.modelRuntime.getAvailableSnapshot();
    const uniqueProviders = new Set(models.map((model) => model.provider));
    this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  protected configuredDefaultModel(): { id: string; provider: string } | undefined {
    const provider = this.settingsManager.getDefaultProvider();
    const id = this.settingsManager.getDefaultModel();
    return provider !== undefined && provider !== "" && id !== undefined && id !== ""
      ? { id, provider }
      : undefined;
  }

  protected getPathCommandArgument(
    text: string,
    command: "/export" | "/import",
  ): string | undefined {
    if (text === command) {
      return undefined;
    }
    if (!text.startsWith(`${command} `)) {
      return undefined;
    }

    const argsString = text.slice(command.length + 1).trimStart();
    if (argsString === "") {
      return undefined;
    }

    const firstChar = argsString[0];
    if (firstChar === '"' || firstChar === "'") {
      const closingQuoteIndex = argsString.indexOf(firstChar, 1);
      if (closingQuoteIndex < 0) {
        return undefined;
      }
      return argsString.slice(1, closingQuoteIndex);
    }

    const firstWhitespaceIndex = argsString.search(/\s/u);
    if (firstWhitespaceIndex < 0) {
      return argsString;
    }
    return argsString.slice(0, firstWhitespaceIndex);
  }

  protected isSkillCommand(text: string): boolean {
    if (!this.settingsManager.getEnableSkillCommands()) return false;
    const name = slashCommandName(text);
    return this.session.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }
}
