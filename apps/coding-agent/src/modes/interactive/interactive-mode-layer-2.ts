import type compatTypes from "@msa/ai/compat.types";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../core/extensions/index.types.ts";
import type assistantMessageTypes from "./components/assistant-message.types.ts";
import mermaid from "./components/mermaid.ts";
import type themedTextTypes from "./components/themed-text.types.ts";
import type toolExecutionTypes from "./components/tool-execution.types.ts";
import type toolGroupTypes from "./components/tool-group.types.ts";
import InteractiveModeLayer1 from "./interactive-mode-layer-1.ts";
import themeModule from "./theme/theme.ts";

const { createMermaidMarkdownTransformer } = mermaid;
const { theme } = themeModule;

export default abstract class InteractiveModeLayer2 extends InteractiveModeLayer1 {
  protected workingIndicatorOptions: extensionsTypes.WorkingIndicatorOptions | undefined =
    undefined;
  protected readonly defaultWorkingMessage = "Working";
  protected readonly defaultHiddenThinkingLabel = "Thinking...";
  protected hiddenThinkingLabel = this.defaultHiddenThinkingLabel;
  protected lastSigintTime = 0;
  protected lastEscapeTime = 0;
  protected changelogMarkdown: string | undefined = undefined;
  protected startupNoticesShown = false;
  protected lastStatusSpacer: tuiTypes.Spacer | undefined = undefined;
  protected lastStatusText: themedTextTypes.ThemedText | undefined = undefined;
  protected lastStatusMessage = "";
  protected managedToolStatusStarted = false;
  protected streamingComponent: assistantMessageTypes.AssistantMessageComponent | undefined =
    undefined;
  protected readonly entriesRenderedByBoundaryCompaction = new Set<string>();
  protected streamingMessage: compatTypes.AssistantMessage | undefined = undefined;
  protected pendingTools = new Map<string, toolExecutionTypes.ToolExecutionComponent>();
  protected toolGroup?: toolGroupTypes.ToolGroupComponent;
  protected toolOutputExpanded = false;
  protected hideThinkingBlock = false;
  protected outputPad = 1;
  protected readonly mermaidMarkdownTransformer: extensionsTypes.MarkdownTransformer =
    createMermaidMarkdownTransformer({
      getMode: () => this.settingsManager.getMermaidRenderingMode(),
      theme,
    });
  protected skillCommands = new Map<string, string>();
  protected unsubscribe?: (() => void) | undefined;
  protected signalCleanupHandlers: Array<() => void> = [];
  protected isBashMode = false;
}
