import * as fs from "node:fs";
import * as os from "node:os";

import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import chalk from "chalk";
import { Effect, Option, Stream } from "effect";
import { ChildProcess } from "effect/process";

import {
  APP_NAME,
  APP_TITLE,
  CONFIG_DIR_NAME,
  RELEASES_URL,
  VERSION,
  detectInstallChange,
  getAgentDir,
  getDebugLogPath,
} from "../../config.ts";
import { completeAccountsArgument, runAccountsCommand } from "../../core/accounts.ts";
import {
  type AgentSessionRuntime,
  SessionImportFileNotFoundError,
} from "../../core/agent-session-runtime.ts";
import type { AgentSessionRuntimeDiagnostic } from "../../core/agent-session-services.ts";
import {
  type AgentSession,
  type AgentSessionEvent,
  parseSkillBlock,
} from "../../core/agent-session.ts";
import { awaited, awaiting, awaitingWith, performed } from "../../core/awaiting.ts";
import {
  CACHE_TTL_MS,
  type CacheMiss,
  collectCacheMisses,
  computeCacheWaste,
  detectCacheMiss,
} from "../../core/cache-stats.ts";
import { formatCacheWarmingUsage } from "../../core/cache-warmer.ts";
import type { CrashRecord } from "../../core/crash-log.ts";
import {
  findExtensionStackMatches,
  recordCrash,
  takeUnnotifiedCrash,
} from "../../core/crash-log.ts";
import { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } from "../../core/defaults.ts";
import type {
  AutocompleteProviderFactory,
  EditorFactory,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionRunner,
  ExtensionUIContext,
  MarkdownTransformer,
  MessageRenderer,
  ProjectTrustContext,
  UserBashEventResult,
  WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
  FooterDataProvider,
  type ReadonlyFooterDataProvider,
} from "../../core/footer-data-provider.ts";
import { describeGoalEntry, describeGoalStatus } from "../../core/goal.ts";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "../../core/http-dispatcher.ts";
import { type AppKeybinding, KeybindingsManager } from "../../core/keybindings.ts";
import { createCompactionSummaryMessage, createCustomMessage } from "../../core/messages.ts";
import { saveModelPolicy } from "../../core/model-policy.ts";
import {
  findExactModelReferenceMatch,
  findModelPolicyDenial,
  formatModelPolicyDenialError,
  resolveModelScopeFromModels,
} from "../../core/model-resolver.ts";
import {
  candidatesNamedByChanges,
  createUpgradeReplacements,
  findModelUpgrades,
  planModelUpgrades,
  rewriteModelReferencesInSettings,
} from "../../core/model-upgrade.ts";
import { describeTelemetry } from "../../core/observability/telemetry.ts";
import { ORCHESTRATOR_REPORT_MESSAGE_TYPE } from "../../core/orchestrator/orchestrator.ts";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import {
  type Scheduled,
  nowIso,
  nowMs,
  schedule,
  toDate,
  writeError,
  writeLog,
} from "../../core/platform.ts";
import { readEnv } from "../../core/process-env.ts";
import type { ResourceDiagnostic } from "../../core/resource-loader.ts";
import { MissingSessionCwdError, formatMissingSessionCwdPrompt } from "../../core/session-cwd.ts";
import {
  type SessionEntry,
  SessionManager,
  type UsageEntry,
  sessionEntryToContextMessages,
} from "../../core/session-manager.ts";
import type { FullscreenExitOutput, TuiMode } from "../../core/settings-manager.ts";
import {
  BUILTIN_SLASH_COMMANDS,
  INIT_PROMPT,
  canonicalizeBuiltinSlashCommand,
  formatHelpMarkdown,
  handoffPrompt,
  isBuiltinSlashCommandName,
  parseHandoffCommand,
  slashCommandName,
  withSkillCommands,
} from "../../core/slash-commands.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import { withBuiltInRenderers } from "../../core/tools/renderers/index.ts";
import type { TruncationResult } from "../../core/tools/truncate.ts";
import { ProjectTrustStore, hasTrustRequiringProjectResources } from "../../core/trust-manager.ts";
import { getUsageCostBreakdown } from "../../core/usage-totals.ts";
import {
  getChangelogPath,
  getNewEntries,
  normalizeChangelogLinks,
  parseChangelog,
} from "../../utils/changelog.ts";
import {
  type ClipboardImage,
  extensionForImageMimeType,
  readClipboardImage,
  readClipboardImageFromCommand,
} from "../../utils/clipboard-image.ts";
import {
  copyToClipboard,
  readClipboardFilePaths,
  readClipboardText,
} from "../../utils/clipboard.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { parseGitUrl } from "../../utils/git.ts";
import { ensurePngTranscoder } from "../../utils/image-convert.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { loadAllHighlightLanguages } from "../../utils/syntax-highlight.ts";
import { type ToolStatus, ensureTool } from "../../utils/tools-manager.ts";
import { type LatestMsaRelease, checkForNewMsaVersion } from "../../utils/version-check.ts";
import { every } from "../interval.ts";
import { basename, dirname, join, randomUuid } from "../path.ts";
import { nodeRuntime } from "../services.ts";
import { reportBug } from "./bug-report.ts";
import { createChatViewport } from "./chat-viewport.ts";
import { ArminComponent } from "./components/armin.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { BashExecutionComponent } from "./components/bash-execution.ts";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.ts";
import { CustomEditor } from "./components/custom-editor.ts";
import { CustomEntryComponent } from "./components/custom-entry.ts";
import { CustomMessageComponent } from "./components/custom-message.ts";
import { DynamicBorder } from "./components/dynamic-border.ts";
import { EarendilAnnouncementComponent } from "./components/earendil-announcement.ts";
import { playArmin3d } from "./components/easter-egg-3d.lazy.ts";
import { ExpandableText, isExpandable } from "./components/expandable-text.ts";
import { FooterComponent, formatTokens } from "./components/footer.ts";
import {
  formatKeyText,
  keyDisplayText,
  keyHint,
  keyText,
  rawKeyHint,
} from "./components/keybinding-hints.ts";
import { wordmark } from "./components/logo.ts";
import { MemoryView } from "./components/memory-view.ts";
import { createMermaidMarkdownTransformer } from "./components/mermaid.ts";
import { ModelSelectorComponent } from "./components/model-selector.ts";
import { ModelUpgradeSelectorComponent } from "./components/model-upgrade-selector.ts";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.ts";
import { SessionSelectorComponent } from "./components/session-selector.ts";
import { SettingsSelectorComponent } from "./components/settings-selector.ts";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.ts";
import {
  BranchSummaryStatusIndicator,
  CompactionStatusIndicator,
  IdleStatus,
  RetryStatusIndicator,
  type StatusIndicator,
  WorkingStatusIndicator,
} from "./components/status-indicator.ts";
import { createTaskReportRenderer, viewHelpers } from "./components/tasks-view-helpers.ts";
import { TasksView } from "./components/tasks-view.ts";
import { ThemedText } from "./components/themed-text.ts";
import { ThinkingSelectorComponent } from "./components/thinking-selector.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { ToolGroupComponent } from "./components/tool-group.ts";
import { TreeSelectorComponent } from "./components/tree-selector.ts";
import { TrustSelectorComponent } from "./components/trust-selector.ts";
import { UserMessageSelectorComponent } from "./components/user-message-selector.ts";
import { UserMessageComponent } from "./components/user-message.ts";
import { EditorSlot } from "./editor-slot.ts";
import {
  EMPTY_ENTER_BURST_IDLE,
  type EmptyEnterBurst,
  registerEmptyEnter,
} from "./empty-enter-burst.ts";
import { ExtensionDialogs } from "./extension-dialogs.ts";
import { ExtensionWidgets } from "./extension-widgets.ts";
import { editInExternalEditor } from "./external-editor.ts";
import { offerHandoff } from "./handoff-resume.ts";
import { formatHotkeysMarkdown } from "./hotkeys.ts";
import { getStartupVisibility, renderLoadedResources } from "./loaded-resources.ts";
import {
  LoginFlow,
  formatLoginProviderCompletionDescription,
  getLoginProviderCompletionOptions,
  getLoginProviderSearchText,
} from "./login-flow.ts";
import { refreshModelCatalogs } from "./model-catalog-refresh.ts";
import { getModelSearchText } from "./model-search.ts";
import { OrchestratorPane } from "./orchestrator-pane.ts";
import { ProgramStatusReporter } from "./program-status-reporter.ts";
import { type SessionInfo, formatSessionInfo } from "./session-info.ts";
import { shareSession } from "./session-share.ts";
import { InteractiveThemeController } from "./theme/theme-controller.ts";
import {
  SYSTEM_THEME_NAME,
  Theme,
  getAvailableThemes,
  getAvailableThemesWithPaths,
  getEditorTheme,
  getMarkdownTheme,
  getThemeByName,
  onThemeChange,
  setRegisteredThemes,
  stopThemeWatcher,
  theme,
} from "./theme/theme.ts";
import { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

const { isRetryableAssistantError } = compat;

const {
  CombinedAutocompleteProvider,
  Container,
  Markdown,
  Spacer,
  Text,
  TruncatedText,
  TuiAltScreen,
  TuiMainScreen,
  fuzzyFilter,
  getCapabilities,
  hyperlink,
  matchesKey,
  setCapabilityOverrides,
  setKeybindings,
  visibleWidth,
} = tuiModule;

export { createInteractiveTui, createInteractiveTuiReference } from "./tui-renderer.ts";

interface ActiveEditor extends tuiTypes.EditorComponent {
  getCursor?(): { line: number; col: number };
}

interface WorkingStatusEditor extends tuiTypes.EditorComponent {
  readonly embedWorkingStatus: boolean;
  setWorkingStatusIndicator(indicator: StatusIndicator | undefined): void;
}

function isEmbeddedStatus(editor: tuiTypes.EditorComponent): editor is WorkingStatusEditor {
  return (
    "embedWorkingStatus" in editor &&
    editor.embedWorkingStatus === true &&
    "setWorkingStatusIndicator" in editor &&
    typeof editor.setWorkingStatusIndicator === "function"
  );
}

type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
};

type CompactionCostNotice = {
  type: "compaction_cost";
  kind: "compaction" | "branch_summary";
  usage: compatTypes.Usage;
};

type RenderSessionItem =
  | agentTypes.AgentMessage
  | Extract<SessionEntry, { type: "custom" | "usage" }>
  | CompactionCostNotice;

function isCustomSessionEntry(
  item: RenderSessionItem,
): item is Extract<SessionEntry, { type: "custom" }> {
  return "type" in item && item.type === "custom";
}

function isCompactionCostNotice(item: RenderSessionItem): item is CompactionCostNotice {
  return "type" in item && item.type === "compaction_cost";
}

function isUsageSessionEntry(
  item: RenderSessionItem,
): item is Extract<SessionEntry, { type: "usage" }> {
  return "type" in item && item.type === "usage";
}

const DEAD_TERMINAL_ERROR_CODES = new Set(["EIO", "EPIPE", "ENOTCONN", "ENOTTY"]);

function isDeadTerminalError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code !== undefined && DEAD_TERMINAL_ERROR_CODES.has(code);
}

export function formatCrashExtensionHint(
  extensionMatches: readonly string[] | undefined,
): string | undefined {
  const matches = Array.isArray(extensionMatches)
    ? extensionMatches.filter(
        (match): match is string => typeof match === "string" && match.length > 0,
      )
    : [];
  if (matches.length === 0) return undefined;
  const quoted = matches.map((match) => `\`${match}\``);
  const labels =
    quoted.length === 1
      ? quoted[0]
      : quoted.length === 2
        ? quoted.join(" and ")
        : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
  const noun = matches.length === 1 ? "extension" : "extensions";
  const pronoun = matches.length === 1 ? "it" : "them";
  return `A stack frame came from loaded ${noun} ${labels}, which may be involved. Try disabling ${pronoun} with \`${APP_NAME} config\`, or run \`${APP_NAME} -ne\` to confirm.`;
}

function quoteIfNeeded(value: string): string {
  if (value.length > 0 && !/[^a-zA-Z0-9_\-./~:@]/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function formatResumeCommand(sessionManager: SessionManager): string | undefined {
  if (!process.stdout.isTTY) return undefined;
  if (!sessionManager.isPersisted()) return undefined;

  const sessionFile = sessionManager.getSessionFile();
  if (sessionFile === undefined || sessionFile === "" || !fs.existsSync(sessionFile))
    return undefined;

  const args = [APP_NAME];
  if (!sessionManager.usesDefaultSessionDir()) {
    args.push("--session-dir", quoteIfNeeded(sessionManager.getSessionDir()));
  }
  args.push("--session", sessionManager.getSessionId());
  return args.join(" ");
}

function createFuzzyAutocompleteItems<T>(
  items: T[],
  prefix: string,
  getSearchText: (item: T) => string,
  toAutocompleteItem: (item: T) => tuiTypes.AutocompleteItem,
): tuiTypes.AutocompleteItem[] | null {
  const filtered = fuzzyFilter(items, prefix, getSearchText);
  if (filtered.length === 0) return null;
  return filtered.map(toAutocompleteItem);
}

export interface InteractiveModeOptions {
  migratedProviders?: string[] | undefined;
  startupDiagnostics?: AgentSessionRuntimeDiagnostic[] | undefined;
  modelFallbackMessage?: string | undefined;
  autoTrustOnReloadCwd?: string | undefined;
  initialMessage?: string | undefined;
  initialImages?: compatTypes.ImageContent[] | undefined;
  initialMessages?: string[] | undefined;
  verbose?: boolean | undefined;
  tuiMode?: TuiMode | undefined;
  initialThemeSetting?: string | undefined;
  terminal?: tuiTypes.Terminal | undefined;
}

export class InteractiveMode {
  private runtimeHost: AgentSessionRuntime;
  private renderer: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen;
  private ui: tuiTypes.TUI;
  private mainScreenRenderState: tuiTypes.TuiMainScreenRenderState | undefined;
  private loadedResourcesContainer: tuiTypes.Container;
  private chatContainer: tuiTypes.Container;
  private documentContainer: tuiTypes.Container;
  private transcriptScrollView: tuiTypes.ScrollView | undefined;
  private fullscreenLayoutRoot: tuiTypes.Component | undefined;
  private pendingMessagesContainer: tuiTypes.Container;
  private emptyEnterBurst: EmptyEnterBurst = EMPTY_ENTER_BURST_IDLE;
  private statusContainer: tuiTypes.Container;
  private defaultEditor: CustomEditor;
  private editor: ActiveEditor;
  private editorComponentFactory: EditorFactory | undefined;
  private autocompleteProvider: tuiTypes.AutocompleteProvider | undefined;
  private autocompleteProviderWrappers: AutocompleteProviderFactory[] = [];
  private fdPath: string | undefined;
  private editorContainer: tuiTypes.Container;
  private readonly editorSlot: EditorSlot;
  private readonly tasksViewState = viewHelpers.createTasksViewState();
  private readonly orchestratorPane = new OrchestratorPane({
    columns: () => this.ui.terminal.columns,
    orchestrator: () => this.session.orchestrator,
    requestRender: () => this.ui.requestRender(),
    rows: () => Math.max(1, this.ui.terminal.rows),
    state: this.tasksViewState,
  });
  private readonly loginFlow: LoginFlow;
  private footer: FooterComponent;
  private footerContainer: tuiTypes.Container;
  private footerDataProvider: FooterDataProvider;
  private keybindings: KeybindingsManager;
  private version: string;
  private isInitialized = false;
  private onInputCallback?: ((text: string) => void) | undefined;
  private goalTicker: Scheduled | undefined;
  private pendingUserInputs: string[] = [];
  private activeStatusIndicator: StatusIndicator | undefined = undefined;
  private activeWorkingIndicatorEmbedded = false;
  private readonly idleStatus = new IdleStatus();
  private workingMessage: string | undefined = undefined;
  private workingVisible = true;
  private workingIndicatorOptions: WorkingIndicatorOptions | undefined = undefined;
  private readonly defaultWorkingMessage = "Working";
  private readonly defaultHiddenThinkingLabel = "Thinking...";
  private hiddenThinkingLabel = this.defaultHiddenThinkingLabel;

  private lastSigintTime = 0;
  private lastEscapeTime = 0;
  private changelogMarkdown: string | undefined = undefined;
  private startupNoticesShown = false;

  private lastStatusSpacer: tuiTypes.Spacer | undefined = undefined;
  private lastStatusText: ThemedText | undefined = undefined;
  private lastStatusMessage = "";
  private managedToolStatusStarted = false;

  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private readonly entriesRenderedByBoundaryCompaction = new Set<string>();
  private streamingMessage: compatTypes.AssistantMessage | undefined = undefined;

  private pendingTools = new Map<string, ToolExecutionComponent>();
  private toolGroup?: ToolGroupComponent;

  private toolOutputExpanded = false;

  private hideThinkingBlock = false;
  private outputPad = 1;
  private readonly mermaidMarkdownTransformer: MarkdownTransformer =
    createMermaidMarkdownTransformer({
      getMode: () => this.settingsManager.getMermaidRenderingMode(),
      theme,
    });

  private skillCommands = new Map<string, string>();

  private unsubscribe?: (() => void) | undefined;
  private signalCleanupHandlers: Array<() => void> = [];

  private isBashMode = false;

  private bashComponent: BashExecutionComponent | undefined = undefined;

  private pendingBashComponents: BashExecutionComponent[] = [];

  private autoCompactionEscapeHandler?: (() => void) | undefined;

  private retryEscapeHandler?: (() => void) | undefined;

  private compactionQueuedMessages: CompactionQueuedMessage[] = [];

  private shutdownRequested = false;

  private readonly programStatus = new ProgramStatusReporter(
    () => this.ui.terminal,
    () => this.sessionManager.getSessionName(),
  );

  private bugReportHintShown = false;
  private installChangeWarningShown = false;

  private readonly extensionDialogs: ExtensionDialogs;
  private extensionTerminalInputSubscriptions = new Set<{
    handler: (data: string) => { consume?: boolean; data?: string } | undefined;
    unsubscribe: () => void;
  }>();

  private readonly extensionWidgets: ExtensionWidgets;

  private customFooter: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;

  private headerContainer: tuiTypes.Container;

  private builtInHeader: tuiTypes.Component | undefined = undefined;

  private customHeader: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;

  private options: InteractiveModeOptions;
  private readonly onRightClickPaste = (): void => {
    void void this.handleRightClickPaste();
  };
  private autoTrustOnReloadCwd: string | undefined;
  private themeController: InteractiveThemeController;

  private get session(): AgentSession {
    return this.runtimeHost.session;
  }
  private get sessionManager() {
    return this.session.sessionManager;
  }
  private get settingsManager() {
    return this.session.settingsManager;
  }

  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    this.runtimeHost = runtimeHost;
    setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
    const tuiMode = options.tuiMode ?? this.settingsManager.getTuiMode();
    this.options = { ...options, tuiMode };
    this.autoTrustOnReloadCwd = options.autoTrustOnReloadCwd;
    this.runtimeHost.setBeforeSessionInvalidate(() => {
      this.resetExtensionUI();
    });
    this.runtimeHost.setRebindSession(() =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.rebindCurrentSession({ renderBeforeBind: true }));
          this.themeController.applyFromSettings();
        }, this),
      ),
    );
    this.version = VERSION;
    this.renderer = createInteractiveTui({
      fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: this.onRightClickPaste,
      showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
      terminal: options.terminal,
      tuiMode,
    });
    this.ui = createInteractiveTuiReference(() => this.renderer);
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.loadedResourcesContainer = new Container();
    this.chatContainer = new Container();
    this.documentContainer = new Container();
    this.documentContainer.addChild(this.headerContainer);
    this.documentContainer.addChild(this.loadedResourcesContainer);
    this.documentContainer.addChild(this.chatContainer);
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.extensionWidgets = new ExtensionWidgets(this.ui);
    this.keybindings = KeybindingsManager.create();
    setKeybindings(this.keybindings);
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(this.ui, getEditorTheme(), this.keybindings, {
      autocompleteMaxVisible,
      embedWorkingStatus: true,
      paddingX: editorPaddingX,
    });
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.editorContainer.addChild(this.editor as tuiTypes.Component);
    this.editorSlot = new EditorSlot(this.editorContainer, this.ui, () => this.editor);
    const mode = this;
    this.extensionDialogs = new ExtensionDialogs({
      editorSlot: this.editorSlot,
      getExternalEditorCommand: () => this.settingsManager.getExternalEditorCommand(),
      keybindings: this.keybindings,
      programStatus: this.programStatus,
      toggleToolsExpanded: () => this.toggleToolOutputExpansion(),
      ui: this.ui,
    });
    this.loginFlow = new LoginFlow({
      editorSlot: this.editorSlot,
      programStatus: this.programStatus,
      refreshAuthState: () => {
        this.updateAvailableProviderCount();
        this.footer.invalidate();
        this.updateEditorBorderColor();
      },
      get session() {
        return mode.session;
      },
      showError: (message) => this.showError(message),
      showStatus: (message) => this.showStatus(message),
      showWarning: (message) => this.showWarning(message),
      ui: this.ui,
    });
    this.footerDataProvider = new FooterDataProvider(this.sessionManager.getCwd());
    this.footer = new FooterComponent(this.session, this.footerDataProvider);
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footerContainer = new Container();
    this.footerContainer.addChild(this.footer);

    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
    this.outputPad = this.settingsManager.getOutputPad();

    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.themeController = new InteractiveThemeController(this.ui, {
      getSettingsManager: () => this.settingsManager,
      initialThemeSetting: options.initialThemeSetting,
      onChanged: () => this.updateEditorBorderColor(),
      showError: (message) => this.showError(message),
    });
  }

  private getAutocompleteSourceTag(sourceInfo?: SourceInfo): string | undefined {
    if (sourceInfo === undefined || sourceInfo.source === "builtin") {
      return undefined;
    }

    const scopePrefix =
      sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
    const source = sourceInfo.source.trim();

    if (source === "auto" || source === "local" || source === "cli") {
      return scopePrefix;
    }

    if (source.startsWith("npm:")) {
      return `${scopePrefix}:${source}`;
    }

    const gitSource = parseGitUrl(source);
    if (gitSource !== null) {
      const ref = gitSource.ref !== undefined && gitSource.ref !== "" ? `@${gitSource.ref}` : "";
      return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
    }

    return scopePrefix;
  }

  private autocompleteDescription(
    description: string | undefined,
    sourceInfo?: SourceInfo,
  ): { description?: string } {
    const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
    if (sourceTag === undefined || sourceTag === "") {
      return description === undefined ? {} : { description };
    }
    return {
      description:
        description !== undefined && description !== ""
          ? `[${sourceTag}] ${description}`
          : `[${sourceTag}]`,
    };
  }

  private getBuiltInCommandConflictDiagnostics(
    extensionRunner: ExtensionRunner,
  ): ResourceDiagnostic[] {
    return extensionRunner
      .getRegisteredCommands()
      .filter((command) => isBuiltinSlashCommandName(command.name))
      .map((command) => ({
        message:
          command.invocationName === command.name
            ? `Extension command '/${command.name}' conflicts with built-in interactive command. Skipping in autocomplete.`
            : `Extension command '/${command.name}' conflicts with built-in interactive command. Available as '/${command.invocationName}'.`,
        path: command.sourceInfo.path,
        type: "warning" as const,
      }));
  }

  private createBaseAutocompleteProvider(): tuiTypes.AutocompleteProvider {
    const { thinkingCommand, slashCommands } =
      InteractiveMode.createBaseAutocompleteProviderThinkingCommand(this);
    InteractiveMode.createBaseAutocompleteProviderPart2(this, thinkingCommand, slashCommands);

    const templateCommands: tuiTypes.SlashCommand[] = this.session.promptTemplates.map((cmd) => ({
      name: cmd.name,
      ...this.autocompleteDescription(cmd.description, cmd.sourceInfo),
      ...(cmd.argumentHint && { argumentHint: cmd.argumentHint }),
    }));

    const extensionCommands: tuiTypes.SlashCommand[] = this.session.extensionRunner
      .getRegisteredCommands()
      .filter((cmd) => !isBuiltinSlashCommandName(cmd.name))
      .map((cmd) => {
        const slashCommand: tuiTypes.SlashCommand = { name: cmd.invocationName };
        Object.assign(slashCommand, this.autocompleteDescription(cmd.description, cmd.sourceInfo));
        if (cmd.getArgumentCompletions !== undefined) {
          slashCommand.getArgumentCompletions = cmd.getArgumentCompletions;
        }
        return slashCommand;
      });

    this.skillCommands.clear();
    const skillCommandList: tuiTypes.SlashCommand[] = [];
    if (this.settingsManager.getEnableSkillCommands()) {
      for (const skill of this.session.resourceLoader.getSkills().skills) {
        this.skillCommands.set(skill.name, skill.filePath);
        skillCommandList.push({
          name: skill.name,
          ...this.autocompleteDescription(skill.description, skill.sourceInfo),
        });
      }
    }

    return new CombinedAutocompleteProvider(
      withSkillCommands(
        [...slashCommands, ...templateCommands, ...extensionCommands],
        skillCommandList,
      ),
      this.sessionManager.getCwd(),
      this.fdPath,
    );
  }

  private static createBaseAutocompleteProviderThinkingCommand(self: InteractiveMode): {
    thinkingCommand: tuiTypes.SlashCommand | undefined;
    slashCommands: tuiTypes.SlashCommand[];
  } {
    const slashCommands: tuiTypes.SlashCommand[] = BUILTIN_SLASH_COMMANDS.map((command) => {
      const slashCommand: tuiTypes.SlashCommand = {
        description:
          command.aliases === undefined
            ? command.description
            : `${command.description} (${command.aliases.map((alias) => `/${alias}`).join(", ")})`,
        name: command.name,
      };
      if (command.argumentHint !== undefined && command.argumentHint !== "") {
        slashCommand.argumentHint = command.argumentHint;
      }
      return slashCommand;
    });

    const modelCommand = slashCommands.find((command) => command.name === "model");
    if (modelCommand !== undefined) {
      modelCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null => {
        const models =
          self.session.scopedModels.length > 0
            ? self.session.scopedModels.map((s) => s.model)
            : self.session.modelRuntime.getAvailableSnapshot();

        if (models.length === 0) return null;

        const items = models.map((m) => ({
          id: m.id,
          label: `${m.provider}/${m.id}`,
          name: m.name,
          provider: m.provider,
        }));

        return createFuzzyAutocompleteItems(items, prefix, getModelSearchText, (item) => ({
          description: item.provider,
          label: item.id,
          value: item.label,
        }));
      };
    }

    const accountsCommand = slashCommands.find((command) => command.name === "accounts");
    if (accountsCommand !== undefined)
      accountsCommand.getArgumentCompletions = completeAccountsArgument;

    const thinkingCommand = slashCommands.find((command) => command.name === "effort");
    return { slashCommands, thinkingCommand };
  }

  private static createBaseAutocompleteProviderPart2(
    self: InteractiveMode,
    thinkingCommand: tuiTypes.SlashCommand | undefined,
    slashCommands: tuiTypes.SlashCommand[],
  ): void {
    if (thinkingCommand !== undefined) {
      thinkingCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null =>
        createFuzzyAutocompleteItems(
          self.session.getAvailableThinkingLevels(),
          prefix,
          (level) => level,
          (level) => ({
            label: level,
            value: level,
          }),
        );
    }

    const loginCommand = slashCommands.find((command) => command.name === "login");
    if (loginCommand !== undefined) {
      loginCommand.getArgumentCompletions = (
        prefix: string,
      ): tuiTypes.AutocompleteItem[] | null => {
        const providers = getLoginProviderCompletionOptions(self.loginFlow.getProviderOptions());
        const items = [
          ...providers.map((provider) => ({
            item: {
              description: formatLoginProviderCompletionDescription(provider),
              label: provider.id,
              value: provider.id,
            },
            searchText: getLoginProviderSearchText(provider),
          })),
          ...self.session.getExternalServices().map((service) => ({
            item: { description: service.purpose, label: service.id, value: service.id },
            searchText: `${service.id} ${service.name} ${service.purpose}`,
          })),
        ];
        return createFuzzyAutocompleteItems(
          items,
          prefix,
          (entry) => entry.searchText,
          (entry) => entry.item,
        );
      };
    }
  }

  private setupAutocompleteProvider(): void {
    let provider = this.createBaseAutocompleteProvider();
    const triggerCharacters: string[] = [];
    for (const wrapProvider of this.autocompleteProviderWrappers) {
      provider = wrapProvider(provider);
      triggerCharacters.push(...(provider.triggerCharacters ?? []));
    }
    if (triggerCharacters.length > 0) {
      provider.triggerCharacters = [...new Set(triggerCharacters)];
    }

    this.autocompleteProvider = provider;
    this.defaultEditor.setAutocompleteProvider(provider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(provider);
    }
  }

  private showStartupNoticesIfNeeded(): void {
    if (this.startupNoticesShown) {
      return;
    }
    this.startupNoticesShown = true;

    if (this.changelogMarkdown === undefined || this.changelogMarkdown === "") {
      return;
    }

    if (this.chatContainer.children.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
    if (this.settingsManager.getCollapseChangelog()) {
      const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/u);
      const latestVersion = versionMatch === null ? this.version : versionMatch[1];
      const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/release-notes")} to view full changelog.`;
      this.chatContainer.addChild(new Text(condensedText, 1, 0));
    } else {
      this.chatContainer.addChild(
        new ThemedText(() => theme.bold(theme.fg("accent", "What's New")), 1, 0),
      );
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Markdown(this.changelogMarkdown.trim(), 1, 0, this.getMarkdownThemeWithSettings()),
      );
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(new DynamicBorder());
  }

  private mountInteractiveTui(
    tui: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen,
    components: readonly tuiTypes.Component[],
  ): void {
    for (const component of components) tui.addChild(component);
    if (tuiModule.isViewportTUI(tui)) {
      if (this.fullscreenLayoutRoot === undefined)
        throw new Error("Fullscreen layout is not initialized");
      tui.setLayoutRoot(this.fullscreenLayoutRoot);
    }
  }

  private stopInteractiveTui(fullscreenExitOutput: FullscreenExitOutput): void {
    if (this.renderer.mode === "fullscreen" && fullscreenExitOutput === "transcript") {
      while (this.renderer.hasOverlayEntries) this.renderer.hideOverlay();
      this.switchTuiMode("regular", false, false);
      this.renderer.renderNow();
    }
    this.ui.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
  }

  private switchTuiMode(mode: TuiMode, restoreProgress = true, startRenderer = true): boolean {
    const switchTuiModeTerminalResult = InteractiveMode.switchTuiModeTerminal(
      this,
      mode,
      startRenderer,
    );
    if (switchTuiModeTerminalResult.done) return switchTuiModeTerminalResult.value;
    const terminal = switchTuiModeTerminalResult.value;
    this.rebindExtensionTerminalInputListeners();
    if (
      restoreProgress &&
      this.settingsManager.getShowTerminalProgress() &&
      (this.session.isStreaming || this.session.isCompacting)
    ) {
      terminal.setProgress(true);
    }
    return true;
  }

  private static switchTuiModeTerminal(
    self: InteractiveMode,
    mode: TuiMode,
    startRenderer: boolean,
  ): { done: true; value: boolean } | { done: false; value: tuiTypes.Terminal } {
    const previousUi = self.renderer;
    if (mode === previousUi.mode) return { done: true, value: true };
    if (previousUi.hasOverlayEntries) return { done: true, value: false };

    const components = [...previousUi.children];
    const focus = previousUi.getFocusedComponent();
    const terminal = previousUi.terminal;
    const showHardwareCursor = previousUi.getShowHardwareCursor();
    const clearOnShrink = previousUi.getClearOnShrink();
    const onDebug = previousUi.onDebug;
    if (previousUi instanceof TuiMainScreen) {
      self.mainScreenRenderState = previousUi.captureRenderState();
    }

    previousUi.stop({ preserveScreen: true });
    previousUi.setFocus(null);
    previousUi.clear();
    if (tuiModule.isViewportTUI(previousUi)) previousUi.setLayoutRoot(undefined);

    const nextUi = createInteractiveTui({
      fullscreenCopyOnSelect: self.settingsManager.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines: self.settingsManager.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: self.onRightClickPaste,
      showHardwareCursor,
      terminal,
      tuiMode: mode,
    });
    nextUi.setClearOnShrink(clearOnShrink);
    if (onDebug !== undefined) nextUi.onDebug = onDebug;
    if (nextUi instanceof TuiMainScreen && self.mainScreenRenderState !== undefined) {
      nextUi.restoreRenderState(self.mainScreenRenderState);
    }
    self.renderer = nextUi;
    self.options.tuiMode = mode;
    self.mountInteractiveTui(nextUi, components);
    nextUi.invalidate();
    nextUi.setFocus(focus);
    if (!startRenderer) return { done: true, value: true };
    nextUi.start();
    self.themeController.rebindTui();
    return { done: false, value: terminal };
  }

  init(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isInitialized) return;

        const startupVisibility = InteractiveMode.initStartupVisibility(this);
        yield* performed(InteractiveMode.initPart2(this));

        if (startupVisibility.header) {
          const { showDetails, withWordmark, compactInstructions, expandedInstructions } =
            InteractiveMode.initShowDetails(this, startupVisibility);
          InteractiveMode.initPart4(
            this,
            showDetails,
            withWordmark,
            compactInstructions,
            expandedInstructions,
          );
        } else {
          this.builtInHeader = new Text("", 0, 0);
          this.headerContainer.addChild(this.builtInHeader);
        }
        yield* performed(InteractiveMode.initPart5(this));
      }, this),
    );
  }

  private static initStartupVisibility(self: InteractiveMode): {
    header: boolean;
    details: boolean;
  } {
    self.registerSignalHandlers();

    self.changelogMarkdown = self.getChangelogForDisplay();

    const startupVisibility = self.getStartupVisibility();
    if (self.session.scopedModels.length > 0 && startupVisibility.details) {
      const modelList = self.session.scopedModels
        .map((sm) => {
          const thinkingStr = sm.thinkingLevel === undefined ? "" : `:${sm.thinkingLevel}`;
          return `${sm.model.id}${thinkingStr}`;
        })
        .join(", ");
      const cycleKeys = self.keybindings.getKeys("app.model.cycleForward");
      const cycleHint =
        cycleKeys.length > 0
          ? theme.fg(
              "muted",
              ` (${formatKeyText(cycleKeys.join("/"), { capitalize: true })} to cycle)`,
            )
          : "";
      writeLog(theme.fg("dim", `Model scope: ${modelList}${cycleHint}`));
    }

    const viewport = createChatViewport({
      document: self.documentContainer,
      editor: self.editorContainer,
      footer: self.footerContainer,
      pendingMessages: self.pendingMessagesContainer,
      scrollbar: self.settingsManager.getFullscreenScrollbar(),
      scrollbarThumbStyle: (text) => theme.fg("scrollbarThumb", text),
      scrollbarTrackStyle: (text) => theme.fg("scrollbarTrack", text),
      status: self.statusContainer,
      widgetsAbove: self.extensionWidgets.above,
      widgetsBelow: self.extensionWidgets.below,
    });
    self.transcriptScrollView = viewport.transcript;
    self.fullscreenLayoutRoot = self.orchestratorPane.layout(viewport.root);
    return startupVisibility;
  }

  private static initPart2(self: InteractiveMode): Effect.Effect<void> {
    return awaiting(function* () {
      self.mountInteractiveTui(self.renderer, [
        self.documentContainer,
        self.pendingMessagesContainer,
        self.statusContainer,
        self.extensionWidgets.above,
        self.editorContainer,
        self.extensionWidgets.below,
        self.footerContainer,
      ]);
      self.defaultEditor.onAction("app.clear", () => self.handleCtrlC());
      self.defaultEditor.onCtrlD = () => self.handleCtrlD();
      self.defaultEditor.onSubmit = (text) => self.handleStartupSubmit(text);
      self.ui.setFocus(self.editor);

      self.ui.start();
      self.isInitialized = true;
      self.programStatus.report();
      self.ensurePngTranscoder();

      self.themeController.applyFromSettings();
      yield* awaited(self.themeController.waitForTerminalColors());
    });
  }

  private static initShowDetails(
    self: InteractiveMode,
    startupVisibility: { header: boolean; details: boolean },
  ): {
    showDetails: boolean;
    withWordmark: (hints: string) => string;
    compactInstructions: () => string;
    expandedInstructions: () => string;
  } {
    const showDetails = startupVisibility.details;
    const withWordmark = (hints: string) =>
      `${wordmark()} ${theme.fg("dim", `v${self.version}`)}\n${hints}`;

    const hint = (keybinding: AppKeybinding, description: string) =>
      keyHint(keybinding, description);

    const expandedInstructions = () =>
      [
        hint("app.interrupt", "to interrupt"),
        hint("app.clear", "to clear"),
        rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
        hint("app.exit", "to exit (empty)"),
        hint("app.suspend", "to suspend"),
        keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
        hint("app.thinking.cycle", "to cycle thinking level"),
        rawKeyHint(
          `${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`,
          "to cycle models",
        ),
        hint("app.model.select", "to select model"),
        hint("app.tools.expand", "to expand tools"),
        hint("app.thinking.toggle", "to expand thinking"),
        hint("app.editor.external", "for external editor"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
        rawKeyHint("!!", "to run bash (no context)"),
        hint("app.message.followUp", "to queue follow-up"),
        hint("app.message.dequeue", "to edit all queued messages"),
        hint("app.clipboard.pasteImage", "to paste files on macOS, images, or text"),
        rawKeyHint("drop files", "to attach"),
      ].join("\n");
    const compactInstructions = () =>
      [
        hint("app.interrupt", "interrupt"),
        rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
        rawKeyHint("/", "commands"),
        rawKeyHint("!", "bash"),
        hint("app.tools.expand", "more"),
      ].join(theme.fg("muted", " · "));
    return { compactInstructions, expandedInstructions, showDetails, withWordmark };
  }

  private static initPart4(
    self: InteractiveMode,
    showDetails: boolean,
    withWordmark: (hints: string) => string,
    compactInstructions: () => string,
    expandedInstructions: () => string,
  ): void {
    const compactOnboarding = () =>
      theme.fg(
        "dim",
        `Press ${keyText("app.tools.expand")} to show full startup help${showDetails ? " and loaded resources" : ""}.`,
      );
    const onboarding = () =>
      theme.fg(
        "dim",
        `msa can explain its own features and look up its docs. Ask it how to use or extend msa.`,
      );
    const header = new ExpandableText(
      () => `${withWordmark(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`,
      () => `${withWordmark(expandedInstructions())}\n\n${onboarding()}`,
      self.isStartupExpanded(),
      1,
      0,
    );
    self.builtInHeader = header;

    self.headerContainer.addChild(new Spacer(1));
    self.headerContainer.addChild(self.builtInHeader);
    self.headerContainer.addChild(new Spacer(1));
  }

  private static initPart5(self: InteractiveMode): Effect.Effect<void> {
    return awaiting(function* () {
      self.ui.requestRender();

      const [fdPath] = yield* awaited(
        Promise.all([
          ensureTool("fd", (status) => self.showManagedToolStatus(status)),
          ensureTool("rg", (status) => self.showManagedToolStatus(status)),
        ]),
      );
      self.fdPath = fdPath;

      self.setupKeyHandlers();
      self.setupEditorSubmitHandler();
      self.ui.requestRender();

      yield* awaited(self.rebindCurrentSession());

      self.renderInitialMessages();

      onThemeChange(() => {
        self.ui.invalidate();
        self.updateEditorBorderColor();
        self.ui.requestRender();
      });

      self.footerDataProvider.onBranchChange(() => {
        self.ui.requestRender();
      });

      self.updateAvailableProviderCount();

      self.ui.renderNow();
      Effect.runFork(
        awaitingWith(function* () {
          yield* awaited(loadAllHighlightLanguages());
          if (!this.isInitialized) return;
          this.ui.invalidate();
          this.ui.requestRender();
        }, self),
      );
    });
  }

  private updateTerminalTitle(): void {
    const cwdBasename = basename(this.sessionManager.getCwd());
    const sessionName = this.sessionManager.getSessionName();
    if (sessionName !== undefined && sessionName !== "") {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
    } else {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
    }
  }

  run(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        yield* performed(InteractiveMode.runPart1(this));

        const { crash, initialMessage, initialImages, initialMessages } =
          InteractiveMode.runCrash(this);
        yield* performed(
          InteractiveMode.runPart3(this, crash, initialMessage, initialImages, initialMessages),
        );
      }, this),
    );
  }

  private static runPart1(self: InteractiveMode): Effect.Effect<void> {
    return awaiting(function* () {
      yield* awaited(self.init());

      if (readEnv("MSA_OFFLINE") === undefined || readEnv("MSA_OFFLINE") === "") {
        const controller = new AbortController();
        const timeout = schedule(() => controller.abort(), 15_000);
        Effect.runFork(
          awaitingWith(function* () {
            try {
              yield* awaited(refreshModelCatalogs(this.session.modelRuntime, controller.signal));
              this.updateAvailableProviderCount();
            } catch {
            } finally {
              timeout.cancel();
            }
          }, self),
        );
      }

      Effect.runFork(
        awaitingWith(function* () {
          const newRelease = yield* awaited(checkForNewMsaVersion(this.version));
          if (newRelease !== undefined) {
            this.showNewVersionNotification(newRelease);
          }
        }, self),
      );

      Effect.runFork(
        awaitingWith(function* () {
          try {
            const updates = yield* awaited(this.checkForPackageUpdates());
            if (updates.length > 0) {
              this.showPackageUpdateNotification(updates);
            }
          } finally {
            if (process.platform === "win32" && this.isInitialized) {
              this.updateTerminalTitle();
            }
          }
        }, self),
      );
    });
  }

  private static runCrash(self: InteractiveMode): {
    crash: CrashRecord | undefined;
    initialMessage: string | undefined;
    initialImages: compatTypes.ImageContent[] | undefined;
    initialMessages: string[] | undefined;
  } {
    Effect.runFork(
      awaitingWith(function* () {
        const warning = yield* awaited(this.checkTmuxKeyboardSetup());
        if (warning !== undefined && warning !== "") {
          this.showWarning(warning);
        }
      }, self),
    );

    const {
      migratedProviders,
      startupDiagnostics,
      modelFallbackMessage,
      initialMessage,
      initialImages,
      initialMessages,
    } = self.options;

    for (const diagnostic of startupDiagnostics ?? []) {
      if (diagnostic.type === "error") {
        self.showError(diagnostic.message);
      } else if (diagnostic.type === "warning") {
        self.showWarning(diagnostic.message);
      } else {
        self.showStatus(diagnostic.message);
      }
    }

    if (migratedProviders !== undefined && migratedProviders.length > 0) {
      self.showWarning(`Migrated credentials to auth.json: ${migratedProviders.join(", ")}`);
    }

    const modelsJsonError = self.session.modelRuntime.getError();
    if (modelsJsonError !== undefined && modelsJsonError !== "") {
      self.showError(`models.json error: ${modelsJsonError}`);
    }

    if (modelFallbackMessage !== undefined && modelFallbackMessage !== "") {
      self.showWarning(modelFallbackMessage);
    }

    const crash = takeUnnotifiedCrash();
    return { crash, initialImages, initialMessage, initialMessages };
  }

  private static runPart3(
    self: InteractiveMode,
    crash: CrashRecord | undefined,
    initialMessage: string | undefined,
    initialImages: compatTypes.ImageContent[] | undefined,
    initialMessages: string[] | undefined,
  ): Effect.Effect<void> {
    return awaiting(function* () {
      if (crash !== undefined) {
        const when = toDate(crash.timestamp).toLocaleString();
        self.showWarning(
          `${APP_NAME} crashed on ${when} (${crash.message}). Run /bug to report it; the crash details are attached automatically.`,
        );
      }

      if (
        (initialMessage === undefined || initialMessage === "") &&
        (initialMessages === undefined || initialMessages.length === 0)
      ) {
        try {
          yield* awaited(offerHandoff(self.session, self.extensionDialogs));
        } catch (error: unknown) {
          self.showError(error instanceof Error ? error.message : "Unknown error occurred");
        }
      }

      if (initialMessage !== undefined && initialMessage !== "") {
        try {
          yield* awaited(self.session.prompt(initialMessage, { images: initialImages }));
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
          self.showError(errorMessage);
        }
      }

      if (initialMessages !== undefined) {
        for (const message of initialMessages) {
          try {
            yield* awaited(self.session.prompt(message));
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            self.showError(errorMessage);
          }
        }
      }

      while (true) {
        const userInput = yield* awaited(self.getUserInput());
        try {
          yield* awaited(self.session.prompt(userInput));
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
          self.showError(errorMessage);
        }
      }
    });
  }

  private checkForPackageUpdates(): Promise<string[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (readEnv("MSA_OFFLINE") !== undefined && readEnv("MSA_OFFLINE") !== "") {
          return [];
        }

        try {
          const packageManager = new DefaultPackageManager({
            agentDir: getAgentDir(),
            cwd: this.sessionManager.getCwd(),
            settingsManager: this.settingsManager,
          });
          const updates = yield* awaited(packageManager.checkForAvailableUpdates());
          return updates.map((update) => update.displayName);
        } catch {
          return [];
        }
      }, this),
    );
  }

  private checkTmuxKeyboardSetup(): Promise<string | undefined> {
    return Effect.runPromise(
      awaiting(function* () {
        if (readEnv("TMUX") === undefined || readEnv("TMUX") === "") return undefined;

        const runTmuxShow = (option: string): Promise<string | undefined> =>
          nodeRuntime.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const handle = yield* ChildProcess.make("tmux", ["show", "-gv", option], {
                  stderr: "ignore",
                  stdin: "ignore",
                });
                const [stdout, code] = yield* Effect.all(
                  [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
                  { concurrency: 2 },
                );
                return code === 0 ? stdout.trim() : undefined;
              }),
            ).pipe(
              Effect.timeoutOption(2000),
              Effect.map((timed) => Option.getOrElse(timed, () => undefined)),
              Effect.orElseSucceed((): string | undefined => undefined),
            ),
          );

        const [extendedKeys, extendedKeysFormat] = yield* awaited(
          Promise.all([runTmuxShow("extended-keys"), runTmuxShow("extended-keys-format")]),
        );

        if (extendedKeys === undefined) return undefined;

        if (extendedKeys !== "on" && extendedKeys !== "always") {
          return "tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys on` to ~/.tmux.conf and restart tmux.";
        }

        if (extendedKeysFormat === "xterm") {
          return "tmux extended-keys-format is xterm. msa works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux.";
        }

        return undefined;
      }),
    );
  }

  private getChangelogForDisplay(): string | undefined {
    if (this.session.state.messages.length > 0) {
      return undefined;
    }

    const lastVersion = this.settingsManager.getLastChangelogVersion();
    const changelogPath = getChangelogPath();
    const entries = parseChangelog(changelogPath);

    if (lastVersion === undefined || lastVersion === "") {
      this.settingsManager.setLastChangelogVersion(VERSION);
      return undefined;
    }

    const newEntries = getNewEntries(entries, lastVersion);
    if (newEntries.length > 0) {
      this.settingsManager.setLastChangelogVersion(VERSION);
      return newEntries.map((e) => normalizeChangelogLinks(e.content, e)).join("\n\n");
    }

    return undefined;
  }

  private getMarkdownThemeWithSettings(): tuiTypes.MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
    };
  }

  private isStartupExpanded(): boolean {
    return this.options.verbose === true || this.toolOutputExpanded;
  }

  private getStartupVisibility(): { header: boolean; details: boolean } {
    return getStartupVisibility(
      this.settingsManager.getQuietStartup(),
      this.options.verbose === true,
    );
  }

  private showLoadedResources(options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const showListing = options?.force === true || this.getStartupVisibility().details;
    const runner = this.session.extensionRunner;
    renderLoadedResources(
      this.loadedResourcesContainer,
      {
        extensionRunnerDiagnostics: [
          ...runner.getCommandDiagnostics(),
          ...this.getBuiltInCommandConflictDiagnostics(runner),
          ...runner.getShortcutDiagnostics(),
        ],
        promptTemplates: this.session.promptTemplates,
        resourceLoader: this.session.resourceLoader,
      },
      {
        cwd: this.sessionManager.getCwd(),
        expanded: this.isStartupExpanded(),
        extensions: options?.extensions,
        showDiagnostics: showListing || options?.showDiagnosticsWhenQuiet === true,
        showListing,
      },
    );
  }

  private bindCurrentSessionExtensions(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const uiContext = this.createExtensionUIContext();
        yield* awaited(
          this.session.bindExtensions({
            abortHandler: () => {
              this.restoreQueuedMessagesToEditor({ abort: true });
            },
            commandContextActions: {
              fork: (entryId, options) =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    try {
                      const result = yield* awaited(this.runtimeHost.fork(entryId, options));
                      if (!result.cancelled) {
                        this.editor.setText(result.selectedText ?? "");
                        this.showStatus("Forked to new session");
                      }
                      return { cancelled: result.cancelled };
                    } catch (error: unknown) {
                      return yield* awaited(
                        this.handleFatalRuntimeError("Failed to fork session", error),
                      );
                    }
                  }, this),
                ),
              navigateTree: (targetId, options) =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    const result = yield* awaited(
                      this.session.navigateTree(targetId, {
                        summarize: options?.summarize,
                        customInstructions: options?.customInstructions,
                        replaceInstructions: options?.replaceInstructions,
                        label: options?.label,
                      }),
                    );
                    if (result.cancelled) {
                      return { cancelled: true };
                    }

                    this.chatContainer.clear();
                    this.renderInitialMessages();
                    if (
                      result.editorText !== undefined &&
                      result.editorText !== "" &&
                      this.editor.getText().trim() === ""
                    ) {
                      this.editor.setText(result.editorText);
                    }
                    this.showStatus("Navigated to selected point");
                    void void this.flushCompactionQueue({ willRetry: false });
                    return { cancelled: false };
                  }, this),
                ),
              newSession: (options) =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    this.clearStatusIndicator();
                    try {
                      return yield* awaited(this.runtimeHost.newSession(options));
                    } catch (error: unknown) {
                      return yield* awaited(
                        this.handleFatalRuntimeError("Failed to create session", error),
                      );
                    }
                  }, this),
                ),
              reload: () =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    yield* awaited(this.handleReloadCommand());
                  }, this),
                ),
              switchSession: (sessionPath, options) =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    return yield* performed(this.handleResumeSession(sessionPath, options));
                  }, this),
                ),
              waitForIdle: () => this.session.waitForIdle(),
            },
            mode: "tui",
            onError: (error) => {
              this.showExtensionError(error.extensionPath, error.error, error.stack);
            },
            shutdownHandler: () => {
              this.shutdownRequested = true;
              if (this.session.isIdle) {
                void void this.shutdown();
              }
            },
            uiContext,
          }),
        );

        InteractiveMode.bindCurrentSessionExtensionsPart1(this);
      }, this),
    );
  }

  private static bindCurrentSessionExtensionsPart1(self: InteractiveMode): void {
    setRegisteredThemes(self.session.resourceLoader.getThemes().themes);
    self.setupAutocompleteProvider();

    const extensionRunner = self.session.extensionRunner;
    self.setupExtensionShortcuts(extensionRunner);
    self.showLoadedResources({ force: false, showDiagnosticsWhenQuiet: true });
    self.showStartupNoticesIfNeeded();
  }

  private applyFullscreenScrollbarSetting(): void {
    this.transcriptScrollView?.setScrollbar(this.settingsManager.getFullscreenScrollbar());
  }

  private ensurePngTranscoder(): void {
    ensurePngTranscoder(() => {
      this.ui.invalidate();
      this.ui.requestRender();
    });
  }

  private applyRuntimeSettings(): void {
    setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
    this.ensurePngTranscoder();
    configureHttpDispatcher(this.settingsManager.getHttpIdleTimeoutMs());
    this.applyFullscreenScrollbarSetting();
    if (this.renderer instanceof TuiAltScreen) {
      this.renderer.setCopyOnSelect(this.settingsManager.getFullscreenCopyOnSelect());
      this.renderer.setWheelScrollLines(this.settingsManager.getFullscreenWheelScrollLines());
    }
    this.footer.setSession(this.session);
    this.updateGoalTicker();
    void this.session.orchestrator?.refresh();
    this.footer.setAutoCompactEnabled(this.session.autoCompactionEnabled);
    this.footerDataProvider.setCwd(this.sessionManager.getCwd());
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
    this.outputPad = this.settingsManager.getOutputPad();
    this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
    const clearOnShrink = this.settingsManager.getClearOnShrink();
    this.ui.setClearOnShrink(clearOnShrink);
    if (!clearOnShrink && this.activeStatusIndicator === undefined) {
      this.statusContainer.clear();
    }
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor.setPaddingX(editorPaddingX);
    this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (this.editor !== this.defaultEditor) {
      this.editor.setPaddingX?.(editorPaddingX);
      this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
  }

  private rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const session = this.session;

        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.programStatus.reset();
        this.applyRuntimeSettings();

        if (options.renderBeforeBind === true) {
          this.renderCurrentSessionState();
          this.subscribeToAgent();
        }

        yield* awaited(this.bindCurrentSessionExtensions());

        if (this.session !== session) {
          return;
        }

        if (options.renderBeforeBind !== true) {
          this.subscribeToAgent();
        }

        this.updateAvailableProviderCount();
        this.updateEditorBorderColor();
        this.updateTerminalTitle();
      }, this),
    );
  }

  private handleFatalRuntimeError(prefix: string, error: unknown): Promise<never> {
    return Effect.runPromise(
      Effect.sync(() => {
        const message = toErrorMessage(error);
        this.showError(`${prefix}: ${message}`);
        const extensionHint = this.getCrashExtensionHint(error);
        if (extensionHint !== undefined && extensionHint !== "") {
          this.chatContainer.addChild(
            new ThemedText(() => theme.fg("warning", extensionHint), this.outputPad, 0),
          );
        }
        if (this.recordCrash("fatal_error", error)) {
          const instructions = this.crashReportInstructions();
          this.chatContainer.addChild(
            new ThemedText(() => theme.fg("muted", instructions), this.outputPad, 0),
          );
        }
        stopThemeWatcher();
        this.stop("transcript");
        process.exit(1);
      }),
    );
  }

  private getCrashExtensionHint(error: unknown): string | undefined {
    try {
      return formatCrashExtensionHint(
        findExtensionStackMatches(
          error instanceof Error ? error.stack : undefined,
          this.session.resourceLoader.getExtensions().extensions,
        ),
      );
    } catch {
      return undefined;
    }
  }

  private recordCrash(kind: "uncaught_exception" | "fatal_error", error: unknown): boolean {
    try {
      return (
        recordCrash({
          cwd: this.session.sessionManager.getCwd(),
          error,
          kind,
          sessionFile: this.session.sessionFile,
        }) !== undefined
      );
    } catch {
      return false;
    }
  }

  private crashReportInstructions(): string {
    const resume =
      this.session.sessionFile !== undefined && this.session.sessionFile !== ""
        ? `run \`${APP_NAME} -r\` to resume the session, then`
        : "start msa and";
    return `To report this crash: ${resume} run /bug. The crash details are attached automatically.`;
  }

  private suggestBugReport(): void {
    if (this.bugReportHintShown) return;
    this.bugReportHintShown = true;
    this.chatContainer.addChild(
      new ThemedText(
        () =>
          theme.fg(
            "muted",
            `If this looks like a ${APP_NAME} bug, /bug sends a report to the developers.`,
          ),
        this.outputPad,
        0,
      ),
    );
    this.ui.requestRender();
  }

  private maybeSuggestBugReport(message: compatTypes.AssistantMessage): void {
    if (message.stopReason !== "error" || isRetryableAssistantError(message)) return;
    if (/\b(?:abort(?:ed)?|cancel(?:l?ed)?)\b/iu.test(message.errorMessage ?? "")) return;
    if (this.maybeShowInstallChangeWarning()) return;
    this.suggestBugReport();
  }

  private maybeShowInstallChangeWarning(): boolean {
    if (this.installChangeWarningShown) return true;
    const change = detectInstallChange();
    if (change === undefined) return false;
    this.installChangeWarningShown = true;
    const cause =
      change.kind === "updated"
        ? `${APP_NAME} was updated to ${change.version} while this session was running (${VERSION})`
        : `The ${APP_NAME} installation this session runs from was removed or replaced`;
    const resumeCommand = formatResumeCommand(this.sessionManager);
    const restart =
      resumeCommand !== undefined && resumeCommand !== ""
        ? `Restart with \`${resumeCommand}\` to continue this session.`
        : `Restart ${APP_NAME}.`;
    this.showWarning(
      `${cause}. Features that load code on demand can fail until restart. ${restart}`,
    );
    return true;
  }

  private renderCurrentSessionState(): void {
    this.loadedResourcesContainer.clear();
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();
    this.renderInitialMessages();
  }

  private getRegisteredToolDefinition(toolName: string) {
    return this.session.extensionRunner.resolveToolRenderers(toolName, () =>
      withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName)),
    );
  }

  private getMarkdownTransformers(): MarkdownTransformer[] {
    return [
      this.mermaidMarkdownTransformer,
      ...this.session.extensionRunner.getMarkdownTransformers(),
    ];
  }

  private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(this.keybindings.getEffectiveConfig());
    if (shortcuts.size === 0) return;

    const createContext = InteractiveMode.setupExtensionShortcutsCreateContext(
      this,
      extensionRunner,
    );

    this.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        if (matchesKey(data, shortcutStr as tuiTypes.KeyId)) {
          Promise.resolve(shortcut.handler(createContext())).catch((err) => {
            this.showError(`Shortcut handler error: ${toErrorMessage(err)}`);
          });
          return true;
        }
      }
      return false;
    };
  }

  private static setupExtensionShortcutsCreateContext(
    self: InteractiveMode,
    extensionRunner: ExtensionRunner,
  ): () => ExtensionContext {
    const createContext = (): ExtensionContext => ({
      abort: () => {
        self.restoreQueuedMessagesToEditor({ abort: true });
      },
      compact: (options) => {
        void (() =>
          Effect.runPromise(
            awaitingWith(function* () {
              try {
                const result = yield* awaited(this.session.compact(options?.customInstructions));
                options?.onComplete?.(result);
              } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                options?.onError?.(err);
              }
            }, self),
          ))();
      },
      cwd: self.sessionManager.getCwd(),
      getContextUsage: () => self.session.getContextUsage(),
      getSystemPrompt: () => self.session.systemPrompt,
      hasPendingMessages: () => self.session.pendingMessageCount > 0,
      hasUI: true,
      isIdle: () => self.session.isIdle,
      isProjectTrusted: () => self.settingsManager.isProjectTrusted(),
      mode: "tui",
      model: self.session.model,
      modelRegistry: extensionRunner.getModelRegistry(),
      scopedModels: self.session.scopedModels,
      sessionManager: self.sessionManager,
      shutdown: () => {
        self.shutdownRequested = true;
      },
      signal: self.session.agent.signal,
      thinkingLevel: self.session.thinkingLevel,
      ui: self.createExtensionUIContext(),
    });
    return createContext;
  }

  private setExtensionStatus(key: string, text: string | undefined): void {
    this.footerDataProvider.setExtensionStatus(key, text);
    this.ui.requestRender();
  }

  private setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean {
    this.defaultEditor.setWorkingStatusIndicator(undefined);
    if (!isEmbeddedStatus(this.editor)) return false;
    this.editor.setWorkingStatusIndicator(indicator);
    return true;
  }

  private showStatusIndicator(indicator: StatusIndicator): void {
    this.activeStatusIndicator?.dispose();
    this.activeStatusIndicator = indicator;
    this.activeWorkingIndicatorEmbedded = false;
    this.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (this.setEditorWorkingStatusIndicator(indicator)) {
      this.activeWorkingIndicatorEmbedded = true;
      return;
    }
    this.statusContainer.addChild(indicator);
  }

  private clearStatusIndicator(kind?: StatusIndicator["kind"]): void {
    if (kind !== undefined && this.activeStatusIndicator?.kind !== kind) {
      return;
    }
    const clearedIndicator = this.activeStatusIndicator;
    const clearedIndicatorWasEmbedded = this.activeWorkingIndicatorEmbedded;
    clearedIndicator?.dispose();
    this.activeStatusIndicator = undefined;
    this.activeWorkingIndicatorEmbedded = false;
    this.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (
      clearedIndicator !== undefined &&
      !clearedIndicatorWasEmbedded &&
      this.options.tuiMode === "regular" &&
      this.ui.getClearOnShrink()
    ) {
      this.statusContainer.addChild(this.idleStatus);
    }
  }

  private showWorkingStatusIndicator(): void {
    const colorFn = isEmbeddedStatus(this.editor)
      ? (text: string) =>
          (
            this.editor.borderColor ??
            theme.getThinkingBorderColor(this.session.thinkingLevel || "off")
          )(text)
      : undefined;
    this.showStatusIndicator(
      new WorkingStatusIndicator(
        this.ui,
        this.workingMessage ?? this.defaultWorkingMessage,
        this.workingIndicatorOptions,
        colorFn,
      ),
    );
  }

  private setWorkingVisible(visible: boolean): void {
    this.workingVisible = visible;
    if (!visible) {
      this.clearStatusIndicator("working");
      this.ui.requestRender();
      return;
    }
    if (this.session.isStreaming && this.activeStatusIndicator?.kind !== "working") {
      this.showWorkingStatusIndicator();
    }
    this.ui.requestRender();
  }

  private setWorkingIndicator(options?: WorkingIndicatorOptions): void {
    this.workingIndicatorOptions = options;
    if (this.activeStatusIndicator?.kind === "working") {
      this.activeStatusIndicator.setIndicator(options);
    }
    this.ui.requestRender();
  }

  private setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label ?? this.defaultHiddenThinkingLabel;
    for (const child of this.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHiddenThinkingLabel(this.hiddenThinkingLabel);
      }
    }
    if (this.streamingComponent !== undefined) {
      this.streamingComponent.setHiddenThinkingLabel(this.hiddenThinkingLabel);
    }
    this.ui.requestRender();
  }

  private resetExtensionUI(): void {
    this.extensionDialogs.close();
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.extensionWidgets.clear();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.autocompleteProviderWrappers = [];
    this.setCustomEditorComponent(undefined);
    this.setupAutocompleteProvider();
    this.defaultEditor.onExtensionShortcut = undefined;
    this.updateTerminalTitle();
    this.workingMessage = undefined;
    this.workingVisible = true;
    this.setWorkingIndicator();
    if (this.activeStatusIndicator?.kind === "working") {
      this.activeStatusIndicator.setMessage(
        `${this.defaultWorkingMessage} (${keyText("app.interrupt")} to interrupt)`,
      );
    }
    this.setHiddenThinkingLabel();
  }

  private setExtensionFooter(
    factory:
      | ((
          tui: tuiTypes.TUI,
          thm: Theme,
          footerData: ReadonlyFooterDataProvider,
        ) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.customFooter?.dispose !== undefined) {
      this.customFooter.dispose();
    }

    this.footerContainer.clear();
    if (factory === undefined) {
      this.customFooter = undefined;
      this.footerContainer.addChild(this.footer);
    } else {
      this.customFooter = factory(this.ui, theme, this.footerDataProvider);
      this.footerContainer.addChild(this.customFooter);
    }

    this.ui.requestRender();
  }

  private setExtensionHeader(
    factory:
      | ((tui: tuiTypes.TUI, thm: Theme) => tuiTypes.Component & { dispose?(): void })
      | undefined,
  ): void {
    if (this.builtInHeader === undefined) {
      return;
    }

    if (this.customHeader?.dispose !== undefined) {
      this.customHeader.dispose();
    }

    const currentHeader = this.customHeader || this.builtInHeader;
    const index = this.headerContainer.children.indexOf(currentHeader);

    if (factory === undefined) {
      this.customHeader = undefined;
      if (isExpandable(this.builtInHeader)) {
        this.builtInHeader.setExpanded(this.toolOutputExpanded);
      }
      if (index !== -1) {
        this.headerContainer.children[index] = this.builtInHeader;
      }
    } else {
      this.customHeader = factory(this.ui, theme);
      if (isExpandable(this.customHeader)) {
        this.customHeader.setExpanded(this.toolOutputExpanded);
      }
      if (index === -1) {
        this.headerContainer.children.unshift(this.customHeader);
      } else {
        this.headerContainer.children[index] = this.customHeader;
      }
    }

    this.ui.requestRender();
  }

  private addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const subscription = { handler, unsubscribe: this.ui.addInputListener(handler) };
    this.extensionTerminalInputSubscriptions.add(subscription);
    return () => {
      subscription.unsubscribe();
      this.extensionTerminalInputSubscriptions.delete(subscription);
    };
  }

  private rebindExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) {
      subscription.unsubscribe();
      subscription.unsubscribe = this.ui.addInputListener(subscription.handler);
    }
  }

  private clearExtensionTerminalInputListeners(): void {
    for (const subscription of this.extensionTerminalInputSubscriptions) subscription.unsubscribe();
    this.extensionTerminalInputSubscriptions.clear();
  }

  private createProjectTrustContext(cwd: string): ProjectTrustContext {
    const ui = this.createExtensionUIContext();
    return {
      cwd,
      hasUI: true,
      mode: "tui",
      ui: {
        confirm: ui.confirm,
        input: ui.input,
        notify: ui.notify,
        select: ui.select,
      },
    };
  }

  private createExtensionUIContext(): ExtensionUIContext {
    return {
      addAutocompleteProvider: (factory) => {
        this.autocompleteProviderWrappers.push(factory);
        this.setupAutocompleteProvider();
      },
      confirm: (title, message, opts) => this.extensionDialogs.confirm(title, message, opts),
      custom: (factory, options) => this.showExtensionCustom(factory, options),
      editor: (title, prefill) => this.extensionDialogs.editor(title, prefill),
      getAllThemes: () => getAvailableThemesWithPaths(),
      getEditorComponent: () => this.editorComponentFactory,
      getEditorText: () => this.editor.getExpandedText?.() ?? this.editor.getText(),
      getTheme: (name) => getThemeByName(name),
      getToolsExpanded: () => this.toolOutputExpanded,
      input: (title, placeholder, opts) => this.extensionDialogs.input(title, placeholder, opts),
      notify: (message, type) => this.showExtensionNotify(message, type),
      onTerminalInput: (handler) => this.addExtensionTerminalInputListener(handler),
      pasteToEditor: (text) => this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      select: (title, options, opts) => this.extensionDialogs.select(title, options, opts),
      setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
      setEditorText: (text) => this.editor.setText(text),
      setFooter: (factory) => this.setExtensionFooter(factory),
      setHeader: (factory) => this.setExtensionHeader(factory),
      setHiddenThinkingLabel: (label) => this.setHiddenThinkingLabel(label),
      setStatus: (key, text) => this.setExtensionStatus(key, text),
      setTheme: (themeOrName) => {
        if (themeOrName instanceof Theme) {
          return this.themeController.setThemeInstance(themeOrName);
        }
        const result = this.themeController.setThemeName(themeOrName);
        if (result.success) {
          if (this.settingsManager.getTheme() !== themeOrName) {
            this.settingsManager.setTheme(themeOrName);
          }
        }
        return result;
      },
      setTitle: (title) => this.ui.terminal.setTitle(title),
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
      setWidget: (key, content, options) => this.extensionWidgets.set(key, content, options),
      setWorkingIndicator: (options) => this.setWorkingIndicator(options),
      setWorkingMessage: (message) => {
        this.workingMessage = message;
        if (this.activeStatusIndicator?.kind === "working") {
          this.activeStatusIndicator.setMessage(message ?? this.defaultWorkingMessage);
        }
      },
      setWorkingVisible: (visible) => this.setWorkingVisible(visible),
      get theme() {
        return theme;
      },
    };
  }

  private promptForMissingSessionCwd(error: MissingSessionCwdError): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const confirmed = yield* awaited(
          this.extensionDialogs.confirm(
            "Session cwd not found",
            formatMissingSessionCwdPrompt(error.issue),
          ),
        );
        return confirmed ? error.issue.fallbackCwd : undefined;
      }, this),
    );
  }

  private setCustomEditorComponent(factory: EditorFactory | undefined): void {
    this.editorComponentFactory = factory;

    const currentText = this.editor.getText();

    this.editorSlot.disposeActiveSelector();

    if (factory === undefined) {
      this.defaultEditor.setText(currentText);
      this.editor = this.defaultEditor;
    } else {
      const { customEditor, newEditor } = InteractiveMode.setCustomEditorComponentCustomEditor(
        this,
        factory,
        currentText,
      );
      InteractiveMode.setCustomEditorComponentPart2(this, customEditor, newEditor);
    }

    if (this.activeStatusIndicator !== undefined) {
      this.statusContainer.clear();
      this.activeWorkingIndicatorEmbedded = this.setEditorWorkingStatusIndicator(
        this.activeStatusIndicator,
      );
      if (!this.activeWorkingIndicatorEmbedded) {
        this.statusContainer.addChild(this.activeStatusIndicator);
      }
    }
    this.editorSlot.show(this.editor);
  }

  private static setCustomEditorComponentCustomEditor(
    self: InteractiveMode,
    factory: EditorFactory,
    currentText: string,
  ): { customEditor: Record<string, unknown>; newEditor: tuiTypes.EditorComponent } {
    const newEditor = factory(self.ui, getEditorTheme(), self.keybindings);

    if (self.defaultEditor.onSubmit !== undefined) newEditor.onSubmit = self.defaultEditor.onSubmit;
    if (self.defaultEditor.onChange !== undefined) newEditor.onChange = self.defaultEditor.onChange;

    newEditor.setText(currentText);

    if (newEditor.borderColor !== undefined) {
      newEditor.borderColor = self.defaultEditor.borderColor;
    }
    if (newEditor.setPaddingX !== undefined) {
      newEditor.setPaddingX(self.defaultEditor.getPaddingX());
    }
    if (newEditor.setAutocompleteMaxVisible !== undefined) {
      newEditor.setAutocompleteMaxVisible(self.defaultEditor.getAutocompleteMaxVisible());
    }

    if (
      newEditor.setAutocompleteProvider !== undefined &&
      self.autocompleteProvider !== undefined
    ) {
      newEditor.setAutocompleteProvider(self.autocompleteProvider);
    }

    const customEditor = newEditor as unknown as Record<string, unknown>;
    return { customEditor, newEditor };
  }

  private static setCustomEditorComponentPart2(
    self: InteractiveMode,
    customEditor: Record<string, unknown>,
    newEditor: tuiTypes.EditorComponent,
  ): void {
    if ("actionHandlers" in customEditor && customEditor["actionHandlers"] instanceof Map) {
      if (customEditor["onEscape"] === undefined) {
        customEditor["onEscape"] = () => self.defaultEditor.onEscape?.();
      }
      if (customEditor["onCtrlD"] === undefined) {
        customEditor["onCtrlD"] = () => self.defaultEditor.onCtrlD?.();
      }
      if (customEditor["onPasteImage"] === undefined) {
        customEditor["onPasteImage"] = () => self.defaultEditor.onPasteImage?.();
      }
      if (customEditor["onExtensionShortcut"] === undefined) {
        customEditor["onExtensionShortcut"] = (data: string) =>
          self.defaultEditor.onExtensionShortcut?.(data);
      }
      for (const [action, handler] of self.defaultEditor.actionHandlers) {
        (customEditor["actionHandlers"] as Map<string, () => void>).set(action, handler);
      }
    }

    self.editor = newEditor;
  }

  private showExtensionNotify(message: string, type?: "info" | "warning" | "error"): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  private showExtensionCustom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | (tuiTypes.Component & { dispose?(): void })
      | Promise<tuiTypes.Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: tuiTypes.OverlayOptions | (() => tuiTypes.OverlayOptions);
      onHandle?: (handle: tuiTypes.OverlayHandle) => void;
    },
  ): Promise<T> {
    return Effect.runPromise(
      Effect.callback<T>((resume) => {
        const savedText = this.editor.getText();
        const isOverlay = options?.overlay ?? false;

        const restoreEditor = () => {
          this.editor.setText(savedText);
          this.editorSlot.restoreEditor();
        };

        let component: tuiTypes.Component & { dispose?(): void };
        let closed = false;

        const close = (result: T) => {
          if (closed) return;
          closed = true;
          if (isOverlay) this.ui.hideOverlay();
          else restoreEditor();
          resume(Effect.succeed(result));
          try {
            component?.dispose?.();
          } catch {}
        };

        const mount = (created: tuiTypes.Component & { dispose?(): void }) => {
          if (closed) return;
          component = created;
          if (isOverlay) {
            const resolveOptions = (): tuiTypes.OverlayOptions | undefined => {
              if (options?.overlayOptions !== undefined) {
                const opts =
                  typeof options.overlayOptions === "function"
                    ? options.overlayOptions()
                    : options.overlayOptions;
                return opts;
              }
              const w = (component as { width?: number }).width;
              return w !== undefined && w !== 0 ? { width: w } : undefined;
            };
            const handle = this.ui.showOverlay(component, resolveOptions());
            options?.onHandle?.(handle);
          } else {
            this.editorSlot.disposeActiveSelector();
            this.editorSlot.show(component);
          }
        };

        const abandon = (error: unknown) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          resume(Effect.die(error));
        };

        Effect.runFork(
          awaitingWith(function* () {
            try {
              const created = yield* awaited(factory(this.ui, theme, this.keybindings, close));
              mount(created);
            } catch (error: unknown) {
              abandon(error);
            }
          }, this),
        );
      }),
    );
  }

  private showExtensionError(extensionPath: string, error: string, stack?: string): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new ThemedText(() => theme.fg("error", errorMsg), 1, 0);
    this.chatContainer.addChild(errorText);
    if (stack !== undefined && stack !== "") {
      const stackLines = stack.split("\n").slice(1);
      if (stackLines.length > 0) {
        const renderStack = () =>
          stackLines.map((line) => theme.fg("dim", `  ${line.trim()}`)).join("\n");
        this.chatContainer.addChild(new ThemedText(renderStack, 1, 0));
      }
    }
    this.ui.requestRender();
  }

  private setupKeyHandlers(): void {
    InteractiveMode.setupKeyHandlersPart1(this);
    this.defaultEditor.onAction("app.tools.expand", () => this.toggleToolOutputExpansion());
    this.defaultEditor.onAction("app.thinking.toggle", () => this.toggleThinkingBlockVisibility());
    this.defaultEditor.onAction(
      "app.editor.external",
      () => void Effect.runFork(this.handleOpenExternalEditor()),
    );
    this.defaultEditor.onAction(
      "app.message.copy",
      () => void void this.handleCopyCommand({ flashConfirmation: true, preferSelection: true }),
    );
    this.defaultEditor.onAction("app.message.followUp", () =>
      Effect.runPromise(this.handleFollowUp()),
    );
    this.defaultEditor.onAction("app.message.dequeue", () => this.handleDequeue());
    this.defaultEditor.onAction("app.session.new", () =>
      Effect.runPromise(this.handleClearCommand()),
    );
    this.defaultEditor.onAction("app.session.tree", () => this.showTreeSelector());
    this.defaultEditor.onAction("app.session.fork", () => this.showUserMessageSelector());
    this.defaultEditor.onAction("app.session.resume", () => this.showSessionSelector());
    this.orchestratorPane.bindKeys(this.defaultEditor, () => this.showTasksView());

    this.defaultEditor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode;
      this.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor();
      }
    };

    this.defaultEditor.onPasteImage = () => {
      void void this.handleClipboardPaste();
    };
  }

  private static setupKeyHandlersPart1(self: InteractiveMode): void {
    self.defaultEditor.onEscape = () => {
      if (self.session.isStreaming) {
        self.restoreQueuedMessagesToEditor({ abort: true });
      } else if (self.session.isBashRunning) {
        self.session.abortBash();
      } else if (self.isBashMode) {
        self.editor.setText("");
        self.isBashMode = false;
        self.updateEditorBorderColor();
      } else if (self.editor.getText().trim() === "") {
        const action = self.settingsManager.getDoubleEscapeAction();
        if (action !== "none") {
          const now = nowMs();
          if (now - self.lastEscapeTime < 500) {
            if (action === "tree") {
              self.showTreeSelector();
            } else {
              self.showUserMessageSelector();
            }
            self.lastEscapeTime = 0;
          } else {
            self.lastEscapeTime = now;
          }
        }
      }
    };

    self.defaultEditor.onAction("app.clear", () => self.handleCtrlC());
    self.defaultEditor.onCtrlD = () => self.handleCtrlD();
    self.defaultEditor.onAction("app.suspend", () => self.handleCtrlZ());
    self.defaultEditor.onAction("app.thinking.cycle", () => self.cycleThinkingLevel());
    self.defaultEditor.onAction("app.model.cycleForward", () =>
      Effect.runPromise(self.cycleModel("forward")),
    );
    self.defaultEditor.onAction("app.model.cycleBackward", () =>
      Effect.runPromise(self.cycleModel("backward")),
    );

    self.ui.onDebug = () => self.handleDebugCommand();
    self.defaultEditor.onAction("app.model.select", () => self.showModelSelector());
  }

  private handleRightClickPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const target = this.renderer.getFocusedComponent();
        const handleInput = target?.handleInput;
        if (target === null || handleInput === undefined) return;
        try {
          const text = yield* awaited(readClipboardText());
          if (text === null || text === "" || this.renderer.getFocusedComponent() !== target)
            return;
          handleInput.call(target, `\x1b[200~${text}\x1b[201~`);
          this.ui.requestRender();
        } catch {}
      }, this),
    );
  }

  private handleClipboardPaste(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const imageCommand = this.settingsManager.getClipboardImageCommand();
          if (imageCommand !== undefined && imageCommand !== "") {
            this.showStatus("Reading clipboard image…");
            const image = yield* awaited(readClipboardImageFromCommand(imageCommand));
            if (image !== undefined && image !== null) this.insertClipboardImage(image);
            else if (image === null) this.showStatus("No image in the clipboard");
            else this.showError("clipboardImageCommand failed or printed no image");
            return;
          }

          const filePaths = yield* awaited(readClipboardFilePaths());
          if (filePaths !== null) {
            if (filePaths.some((filePath) => /\p{Cc}/u.test(filePath))) {
              throw new Error("Clipboard file path contains control characters");
            }
            const paths = this.isBashMode
              ? filePaths.map(quoteIfNeeded).join(" ")
              : filePaths.join("\n");
            const cursor = this.editor.getCursor?.();
            const currentLine =
              cursor === undefined ? "" : (this.editor.getText().split("\n")[cursor.line] ?? "");
            const characterBeforeCursor =
              cursor !== undefined && cursor.col > 0 ? currentLine[cursor.col - 1] : "";
            const characterAfterCursor = cursor === undefined ? "" : currentLine[cursor.col];
            const leadingSpace =
              characterBeforeCursor !== undefined &&
              characterBeforeCursor !== "" &&
              !/\s/u.test(characterBeforeCursor)
                ? " "
                : "";
            const trailingSpace =
              characterAfterCursor !== undefined &&
              characterAfterCursor !== "" &&
              !/\s/u.test(characterAfterCursor)
                ? " "
                : "";
            this.editor.insertTextAtCursor?.(`${leadingSpace}${paths}${trailingSpace}`);
            this.ui.requestRender();
            return;
          }

          const image = yield* awaited(readClipboardImage());
          if (image !== null) {
            this.insertClipboardImage(image);
            return;
          }

          const text = yield* awaited(readClipboardText());
          if (text !== null && text !== "") {
            this.editor.insertTextAtCursor?.(text);
            this.ui.requestRender();
          }
        } catch (error) {
          this.showError(`Failed to paste from clipboard: ${toErrorMessage(error)}`);
        }
      }, this),
    );
  }

  private insertClipboardImage(image: ClipboardImage): void {
    const ext = extensionForImageMimeType(image.mimeType) ?? "png";
    const filePath = join(os.tmpdir(), `msa-clipboard-${randomUuid()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(image.bytes));
    this.editor.insertTextAtCursor?.(filePath);
    this.ui.requestRender();
  }

  private handleStartupSubmit(text: string): void {
    this.editor.setText(text);
    this.showStatus("Startup is still in progress");
  }

  private handleBuiltinCommand(text: string): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (text === "/help") {
        this.handleHelpCommand();
        this.editor.setText("");
        return true;
      }
      if (text === "/config") {
        this.showSettingsSelector();
        this.editor.setText("");
        return true;
      }
      if (text === "/scoped-models") {
        this.editor.setText("");
        yield* awaited(this.showModelsSelector());
        return true;
      }
      if (text === "/model" || text.startsWith("/model ")) {
        const searchTerm = text.startsWith("/model ") ? text.slice(7).trim() : undefined;
        this.editor.setText("");
        yield* performed(this.handleModelCommand(searchTerm));
        return true;
      }
      if (text === "/effort" || text.startsWith("/effort ")) {
        const searchTerm = text.startsWith("/effort ") ? text.slice(8).trim() : undefined;
        this.editor.setText("");
        this.handleThinkingCommand(searchTerm);
        return true;
      }
      if (text === "/export" || text.startsWith("/export ")) {
        yield* performed(this.handleExportCommand(text));
        this.editor.setText("");
        return true;
      }
      if (text === "/import" || text.startsWith("/import ")) {
        yield* awaited(this.handleImportCommand(text));
        this.editor.setText("");
        return true;
      }
      if (text === "/share") {
        yield* performed(this.handleShareCommand());
        this.editor.setText("");
        return true;
      }
      if (text === "/bug" || text.startsWith("/bug ")) {
        const hint = text.slice("/bug".length).trim();
        this.editor.setText("");
        yield* performed(this.handleBugCommand(hint === "" ? undefined : hint));
        return true;
      }
      if (text === "/copy") {
        yield* awaited(this.handleCopyCommand());
        this.editor.setText("");
        return true;
      }
      if (text === "/rename" || text.startsWith("/rename ")) {
        this.handleNameCommand(text);
        this.editor.setText("");
        return true;
      }
      if (text === "/status") {
        this.editor.setText("");
        yield* awaited(this.handleSessionCommand());
        return true;
      }
      if (text === "/release-notes") {
        this.handleChangelogCommand();
        this.editor.setText("");
        return true;
      }
      if (text === "/keybindings") {
        this.handleHotkeysCommand();
        this.editor.setText("");
        return true;
      }
      if (text === "/fork") {
        this.showUserMessageSelector();
        this.editor.setText("");
        return true;
      }
      if (text === "/branch") {
        this.editor.setText("");
        yield* awaited(this.handleCloneCommand());
        return true;
      }
      if (text === "/rewind") {
        this.showTreeSelector();
        this.editor.setText("");
        return true;
      }
      if (text === "/trust") {
        this.showTrustSelector();
        this.editor.setText("");
        return true;
      }
      if (text === "/login" || text.startsWith("/login ")) {
        const providerRef = text.startsWith("/login ") ? text.slice(7).trim() : undefined;
        this.editor.setText("");
        yield* awaited(this.loginFlow.login(providerRef));
        return true;
      }
      if (text === "/accounts" || text.startsWith("/accounts ")) {
        this.editor.setText("");
        yield* awaited(
          runAccountsCommand(text.slice("/accounts".length), {
            refreshProviders: () =>
              Effect.runPromise(
                awaitingWith(function* () {
                  yield* awaited(this.session.modelRuntime.refresh({ allowNetwork: false }));
                  this.setupAutocompleteProvider();
                }, this),
              ),
            ui: this.createExtensionUIContext(),
          }),
        );
        return true;
      }
      if (text === "/logout") {
        void this.loginFlow.logout();
        this.editor.setText("");
        return true;
      }
      if (text === "/clear") {
        this.editor.setText("");
        yield* performed(this.handleClearCommand());
        return true;
      }
      if (text === "/compact" || text.startsWith("/compact ")) {
        const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
        this.editor.setText("");
        yield* performed(this.handleCompactCommand(customInstructions));
        return true;
      }
      if (text === "/reload") {
        this.editor.setText("");
        yield* awaited(this.handleReloadCommand());
        return true;
      }
      if (text === "/debug") {
        this.handleDebugCommand();
        this.editor.setText("");
        return true;
      }
      if (text === "/arminsayshi") {
        this.handleArminSaysHi();
        this.editor.setText("");
        return true;
      }
      if (text === "/dementedelves") {
        this.handleDementedDelves();
        this.editor.setText("");
        return true;
      }
      if (text === "/resume") {
        this.showSessionSelector();
        this.editor.setText("");
        return true;
      }
      if (text === "/tasks" || text === "/threads") {
        this.showTasksView();
        this.editor.setText("");
        return true;
      }
      if (text === "/memory") {
        this.showMemoryView();
        this.editor.setText("");
        return true;
      }
      if (text === "/exit") {
        this.editor.setText("");
        yield* awaited(this.shutdown());
        return true;
      }
      return false;
    }, this);
  }

  private setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = (text: string) =>
      Effect.runPromise(
        awaitingWith(function* () {
          text = text.trim();
          if (text === "") {
            this.handleEmptyEnter();
            return;
          }
          this.emptyEnterBurst = EMPTY_ENTER_BURST_IDLE;

          if (text.startsWith("/") && !this.isSkillCommand(text)) {
            text = canonicalizeBuiltinSlashCommand(text);
            const handoff = parseHandoffCommand(text);
            if (text === "/init") text = INIT_PROMPT;
            else if (handoff !== undefined) {
              if (this.session.orchestrator === undefined) {
                this.showWarning(
                  "/handoff needs the orchestrator, which this session does not have",
                );
                this.editor.setText("");
                return;
              }
              text = handoffPrompt(handoff.path);
            } else if (yield* performed(this.handleBuiltinCommand(text))) return;
          }

          if (text.startsWith("!")) {
            const isExcluded = text.startsWith("!!");
            const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
            if (command !== "") {
              if (this.session.isBashRunning) {
                this.showWarning(
                  "A bash command is already running. Press Esc to cancel it first.",
                );
                this.editor.setText(text);
                return;
              }
              this.editor.addToHistory?.(text);
              yield* awaited(this.handleBashCommand(command, isExcluded));
              this.isBashMode = false;
              this.updateEditorBorderColor();
              return;
            }
          }

          if (this.session.isCompacting) {
            if (this.isExtensionCommand(text)) {
              this.editor.addToHistory?.(text);
              this.editor.setText("");
              yield* awaited(this.session.prompt(text));
            } else {
              this.queueCompactionMessage(text, "steer");
            }
            return;
          }

          if (this.session.isStreaming) {
            this.editor.addToHistory?.(text);
            this.editor.setText("");
            yield* awaited(this.session.prompt(text, { streamingBehavior: "steer" }));
            this.updatePendingMessagesDisplay();
            this.ui.requestRender();
            return;
          }

          this.flushPendingBashComponents();

          if (this.onInputCallback === undefined) {
            this.pendingUserInputs.push(text);
          } else {
            this.onInputCallback(text);
          }
          this.editor.addToHistory?.(text);
        }, this),
      );
  }

  private handleEmptyEnter(): void {
    const { burst, fire } = registerEmptyEnter(this.emptyEnterBurst, nowMs());
    this.emptyEnterBurst = burst;
    if (!fire) return;
    const sent = this.session.flushQueue();
    if (sent === 0) return;
    this.showStatus(`Sent ${sent} queued message${sent > 1 ? "s" : ""}`);
  }

  private subscribeToAgent(): void {
    this.unsubscribe = this.session.subscribe((event) =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.handleEvent(event));
        }, this),
      ),
    );
  }

  private handleEvent(event: AgentSessionEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (!this.isInitialized) {
          yield* awaited(this.init());
        }

        this.footer.invalidate();
        this.programStatus.handleEvent(event);

        switch (event.type) {
          case "agent_start":
            this.pendingTools.clear();
            if (this.retryEscapeHandler !== undefined) {
              this.defaultEditor.onEscape = this.retryEscapeHandler;
              this.retryEscapeHandler = undefined;
            }
            break;

          case "turn_start":
            if (this.settingsManager.getShowTerminalProgress()) {
              this.ui.terminal.setProgress(true);
            }
            if (this.workingVisible) {
              if (this.activeStatusIndicator?.kind !== "working") {
                this.showWorkingStatusIndicator();
              }
            } else {
              this.clearStatusIndicator();
            }
            this.ui.requestRender();
            break;

          case "queue_update":
            this.updatePendingMessagesDisplay();
            this.ui.requestRender();
            break;

          case "entry_appended":
            if (this.entriesRenderedByBoundaryCompaction.delete(event.entry.id)) break;
            if (event.entry.type === "custom") {
              this.addCustomEntryToChat(event.entry);
              this.ui.requestRender();
            } else if (event.entry.type === "usage" && event.entry.kind === "cache_warm") {
              this.addCacheWarmingUsage(event.entry);
              this.ui.requestRender();
            } else if (event.entry.type === "custom_message" && event.entry.display) {
              this.addMessageToChat(
                createCustomMessage(
                  event.entry.customType,
                  event.entry.content,
                  event.entry.display,
                  event.entry.details,
                  event.entry.timestamp,
                ),
              );
              this.ui.requestRender();
            } else if (event.entry.type === "compaction") {
              const entries = this.sessionManager.buildContextEntries();
              if (entries[0]?.id !== event.entry.id) break;
              this.chatContainer.clear();
              const branch = this.sessionManager.getBranch();
              const compactionIndex = branch.findIndex((entry) => entry.id === event.entry.id);
              const entriesAfterCompaction = new Set(
                branch.slice(compactionIndex + 1).map((entry) => entry.id),
              );
              const retainedEntries = entries.slice(1);
              this.renderSessionEntries(
                retainedEntries.filter((entry) => !entriesAfterCompaction.has(entry.id)),
              );
              this.addMessageToChat(
                createCompactionSummaryMessage(
                  event.entry.summary,
                  event.entry.tokensBefore,
                  event.entry.timestamp,
                ),
              );
              if (event.entry.usage !== undefined) {
                this.addCompactionCostNotice({
                  kind: "compaction",
                  type: "compaction_cost",
                  usage: event.entry.usage,
                });
              }
              this.renderSessionEntries(
                retainedEntries.filter((entry) => entriesAfterCompaction.has(entry.id)),
              );
              for (const entryId of entriesAfterCompaction)
                this.entriesRenderedByBoundaryCompaction.add(entryId);
              this.footer.invalidate();
              this.ui.requestRender();
            }
            break;

          case "session_info_changed":
            this.updateTerminalTitle();
            this.footer.invalidate();
            this.ui.requestRender();
            break;

          case "thinking_level_changed":
            this.footer.invalidate();
            this.updateEditorBorderColor();
            break;

          case "message_start":
            if (event.message.role === "custom") {
              this.addMessageToChat(event.message);
              this.ui.requestRender();
            } else if (event.message.role === "user") {
              this.addMessageToChat(event.message);
              this.updatePendingMessagesDisplay();
              this.ui.requestRender();
            } else if (event.message.role === "assistant") {
              this.streamingComponent = new AssistantMessageComponent(
                undefined,
                this.hideThinkingBlock,
                this.getMarkdownThemeWithSettings(),
                this.hiddenThinkingLabel,
                this.outputPad,
                this.getMarkdownTransformers(),
              );
              this.streamingMessage = event.message;
              this.chatContainer.addChild(this.streamingComponent);
              this.streamingComponent.updateContent(this.streamingMessage, true);
              this.ui.requestRender();
            }
            break;

          case "message_update":
            if (this.streamingComponent !== undefined && event.message.role === "assistant") {
              this.streamingMessage = event.message;
              this.streamingComponent.updateContent(this.streamingMessage, true);

              for (const content of this.streamingMessage.content) {
                if (content.type === "toolCall") {
                  if (this.pendingTools.has(content.id)) {
                    const component = this.pendingTools.get(content.id);
                    if (component !== undefined) {
                      component.updateArgs(content.arguments);
                    }
                  } else {
                    const component = new ToolExecutionComponent(
                      content.name,
                      content.id,
                      content.arguments,
                      {
                        imageWidthCells: this.settingsManager.getImageWidthCells(),
                        outputPad: this.outputPad,
                        showImages: this.settingsManager.getShowImages(),
                      },
                      this.getRegisteredToolDefinition(content.name),
                      this.ui,
                      this.sessionManager.getCwd(),
                    );
                    component.setExpanded(this.toolOutputExpanded);
                    this.addToolExecution(component);
                    this.pendingTools.set(content.id, component);
                  }
                }
              }
              this.ui.requestRender();
            }
            break;

          case "message_end":
            if (event.message.role === "user") break;
            if (this.streamingComponent !== undefined && event.message.role === "assistant") {
              this.streamingMessage = event.message;
              let errorMessage: string | undefined;
              if (this.streamingMessage.stopReason === "aborted") {
                const retryAttempt = this.session.retryAttempt;
                errorMessage =
                  retryAttempt > 0
                    ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                    : "Operation aborted";
                this.streamingMessage.errorMessage = errorMessage;
              }
              this.streamingComponent.updateContent(this.streamingMessage, false);

              if (
                this.streamingMessage.stopReason === "aborted" ||
                this.streamingMessage.stopReason === "error"
              ) {
                if (errorMessage === undefined || errorMessage === "") {
                  errorMessage = this.streamingMessage.errorMessage || "Error";
                }
                for (const [, component] of this.pendingTools.entries()) {
                  component.updateResult({
                    content: [{ text: errorMessage, type: "text" }],
                    isError: true,
                  });
                }
                this.pendingTools.clear();
                this.maybeSuggestBugReport(this.streamingMessage);
              } else {
                for (const [, component] of this.pendingTools.entries()) {
                  component.setArgsComplete();
                }
                this.maybeShowThinkingDropNotice(this.streamingMessage);
                this.maybeShowCacheMissNotice(this.streamingMessage);
              }
              this.streamingComponent = undefined;
              this.streamingMessage = undefined;
              this.footer.invalidate();
            }
            this.ui.requestRender();
            break;

          case "bash_execution_update":
            break;

          case "tool_execution_start": {
            if (event.parentToolCallId !== undefined && event.parentToolCallId !== "") break;
            let component = this.pendingTools.get(event.toolCallId);
            if (component === undefined) {
              component = new ToolExecutionComponent(
                event.toolName,
                event.toolCallId,
                event.args,
                {
                  imageWidthCells: this.settingsManager.getImageWidthCells(),
                  outputPad: this.outputPad,
                  showImages: this.settingsManager.getShowImages(),
                },
                this.getRegisteredToolDefinition(event.toolName),
                this.ui,
                this.sessionManager.getCwd(),
              );
              component.setExpanded(this.toolOutputExpanded);
              this.addToolExecution(component);
              this.pendingTools.set(event.toolCallId, component);
            }
            component.markExecutionStarted();
            this.ui.requestRender();
            break;
          }

          case "tool_execution_update": {
            const component = this.pendingTools.get(event.toolCallId);
            if (component !== undefined) {
              component.updateResult({ ...event.partialResult, isError: false }, true);
              this.ui.requestRender();
            }
            break;
          }

          case "tool_execution_end": {
            if (event.isError) this.maybeShowInstallChangeWarning();
            const component = this.pendingTools.get(event.toolCallId);
            if (component !== undefined) {
              component.updateResult({
                ...event.result,
                durationMs: event.durationMs,
                isError: event.isError,
              });
              this.pendingTools.delete(event.toolCallId);
              this.ui.requestRender();
            }
            break;
          }

          case "agent_end":
            if (this.settingsManager.getShowTerminalProgress()) {
              this.ui.terminal.setProgress(false);
            }
            this.clearStatusIndicator("working");
            if (this.streamingComponent !== undefined) {
              this.chatContainer.removeChild(this.streamingComponent);
              this.toolGroup?.items.removeChild(this.streamingComponent);
              const thinking = this.streamingComponent.takenThinking;
              if (thinking !== undefined) this.toolGroup?.items.removeChild(thinking);
              this.streamingComponent = undefined;
              this.streamingMessage = undefined;
            }
            this.pendingTools.clear();

            this.ui.requestRender();
            break;

          case "agent_settled":
            yield* performed(this.checkShutdownRequested());
            break;

          case "compaction_start": {
            if (this.settingsManager.getShowTerminalProgress()) {
              this.ui.terminal.setProgress(true);
            }
            this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
            this.defaultEditor.onEscape = () => {
              this.session.abortCompaction();
            };
            const colorFn = isEmbeddedStatus(this.editor)
              ? (text: string) =>
                  (
                    this.editor.borderColor ??
                    theme.getThinkingBorderColor(this.session.thinkingLevel || "off")
                  )(text)
              : undefined;
            this.showStatusIndicator(new CompactionStatusIndicator(this.ui, event.reason, colorFn));
            this.ui.requestRender();
            break;
          }

          case "compaction_end": {
            InteractiveMode.handleEventPart4(this);
            if (event.aborted) {
              if (event.reason === "manual") {
                this.showError("Compaction cancelled");
              } else {
                this.showStatus("Auto-compaction cancelled");
              }
            } else if (event.result !== undefined) {
              const entries = this.sessionManager.buildContextEntries();
              if (entries[0]?.type !== "compaction") {
                throw new Error("Completed compaction is missing from the session context");
              }
              this.chatContainer.clear();
              this.renderSessionEntries(entries.slice(1));
              this.addMessageToChat(
                createCompactionSummaryMessage(
                  event.result.summary,
                  event.result.tokensBefore,
                  nowIso(),
                ),
              );
              if (event.result.usage !== undefined) {
                this.addCompactionCostNotice({
                  kind: "compaction",
                  type: "compaction_cost",
                  usage: event.result.usage,
                });
              }
              this.footer.invalidate();
            } else if (event.errorMessage !== undefined && event.errorMessage !== "") {
              if (event.reason === "manual") {
                this.showError(event.errorMessage);
              } else {
                this.chatContainer.addChild(new Spacer(1));
                const errorMessage = event.errorMessage;
                this.chatContainer.addChild(
                  new ThemedText(() => theme.fg("error", errorMessage), 1, 0),
                );
              }
            }
            void void this.flushCompactionQueue({ willRetry: event.willRetry });
            this.ui.requestRender();
            break;
          }

          case "auto_retry_start": {
            this.retryEscapeHandler = this.defaultEditor.onEscape;
            this.defaultEditor.onEscape = () => {
              this.session.abortRetry();
            };
            this.showStatusIndicator(
              new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
            );
            this.ui.requestRender();
            break;
          }

          case "auto_retry_end": {
            if (this.retryEscapeHandler !== undefined) {
              this.defaultEditor.onEscape = this.retryEscapeHandler;
              this.retryEscapeHandler = undefined;
            }
            this.clearStatusIndicator("retry");
            if (!event.success) {
              this.showError(
                `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
              );
            }
            this.ui.requestRender();
            break;
          }

          case "summarization_retry_scheduled": {
            this.showError(event.errorMessage);
            this.showStatusIndicator(
              new RetryStatusIndicator(this.ui, event.attempt, event.maxAttempts, event.delayMs),
            );
            this.ui.requestRender();
            break;
          }

          case "summarization_retry_attempt_start": {
            this.clearStatusIndicator("retry");
            if (event.source === "branchSummary") {
              this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
            } else {
              const colorFn = isEmbeddedStatus(this.editor)
                ? (text: string) =>
                    (
                      this.editor.borderColor ??
                      theme.getThinkingBorderColor(this.session.thinkingLevel || "off")
                    )(text)
                : undefined;
              this.showStatusIndicator(
                new CompactionStatusIndicator(this.ui, event.reason, colorFn),
              );
            }
            this.ui.requestRender();
            break;
          }

          case "summarization_retry_finished": {
            this.clearStatusIndicator("retry");
            this.ui.requestRender();
            break;
          }

          case "goal_changed":
            this.updateGoalTicker();
            this.ui.requestRender();
            break;

          case "orchestrator_changed":
            this.footer.invalidate();
            this.ui.requestRender();
            break;

          case "pr_watch_changed":
            this.footer.invalidate();
            this.ui.requestRender();
            break;

          case "goal_status": {
            const goal = event.goal;
            const now = nowMs();
            this.chatContainer.addChild(new Spacer(1));
            const [heading = "", ...rest] = describeGoalStatus(goal, now);
            this.chatContainer.addChild(
              new ThemedText(
                () =>
                  [
                    goal === undefined
                      ? theme.fg("muted", heading)
                      : theme.fg("accent", theme.bold(heading)),
                    ...rest.map((line) => theme.fg("muted", line)),
                  ].join("\n"),
                this.outputPad,
                0,
              ),
            );
            this.ui.requestRender();
            break;
          }

          case "memory_status": {
            this.chatContainer.addChild(new Spacer(1));
            this.chatContainer.addChild(
              new ThemedText(
                () =>
                  event.text
                    .split("\n")
                    .map((line) => theme.fg("muted", line))
                    .join("\n"),
                this.outputPad,
                0,
              ),
            );
            this.ui.requestRender();
            break;
          }
        }
      }, this),
    );
  }

  private static handleEventPart4(self: InteractiveMode): void {
    if (self.settingsManager.getShowTerminalProgress()) {
      self.ui.terminal.setProgress(false);
    }
    if (self.autoCompactionEscapeHandler !== undefined) {
      self.defaultEditor.onEscape = self.autoCompactionEscapeHandler;
      self.autoCompactionEscapeHandler = undefined;
    }
    self.clearStatusIndicator("compaction");
  }

  private updateGoalTicker(): void {
    if (this.session.goal !== undefined) {
      this.goalTicker ??= every(() => this.ui.requestRender(), 1000);
    } else if (this.goalTicker !== undefined) {
      this.goalTicker.cancel();
      this.goalTicker = undefined;
    }
  }

  private getUserMessageText(message: compatTypes.Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ text: message.content, type: "text" }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  private showManagedToolStatus(status: ToolStatus): void {
    if (!this.managedToolStatusStarted) {
      this.chatContainer.addChild(new Spacer(1));
      this.managedToolStatusStarted = true;
    }
    const message = status.type === "warning" ? `Warning: ${status.message}` : status.message;
    const color = status.type === "warning" ? "warning" : "dim";
    this.chatContainer.addChild(new ThemedText(() => theme.fg(color, message), 1, 0));
    this.lastStatusSpacer = undefined;
    this.lastStatusText = undefined;
    this.ui.requestRender();
  }

  private showStatus(message: string): void {
    const children = this.chatContainer.children;
    const last = children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast = children.length > 1 ? children[children.length - 2] : undefined;

    if (
      last !== undefined &&
      secondLast !== undefined &&
      last === this.lastStatusText &&
      secondLast === this.lastStatusSpacer
    ) {
      this.lastStatusMessage = message;
      this.lastStatusText.invalidate();
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    this.lastStatusMessage = message;
    const text = new ThemedText(() => theme.fg("dim", this.lastStatusMessage), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.ui.requestRender();
  }

  private addCustomEntryToChat(entry: Extract<SessionEntry, { type: "custom" }>): void {
    const goalLine = describeGoalEntry(entry);
    if (goalLine !== undefined) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new ThemedText(() => theme.fg(goalLine.tone, goalLine.text), this.outputPad, 0),
      );
      return;
    }
    const renderer = this.session.extensionRunner.getEntryRenderer(entry.customType);
    if (renderer === undefined) {
      return;
    }
    const component = new CustomEntryComponent(entry, renderer, this.outputPad);
    component.setExpanded(this.toolOutputExpanded);
    if (!component.hasContent()) {
      return;
    }

    if (this.streamingComponent !== undefined) {
      const streamingIndex = this.chatContainer.children.indexOf(this.streamingComponent);
      if (streamingIndex >= 0) {
        this.chatContainer.children.splice(streamingIndex, 0, component);
        return;
      }
    }

    this.chatContainer.addChild(component);
  }

  private *chatComponents(): Generator<tuiTypes.Component> {
    for (const child of this.chatContainer.children) {
      yield child;
      if (child instanceof ToolGroupComponent) yield* child.items.children;
    }
  }

  private addToolExecution(component: ToolExecutionComponent): void {
    const children = this.chatContainer.children;
    const isFoldable = (child: tuiTypes.Component | undefined) =>
      child instanceof AssistantMessageComponent && !child.hasVisibleText();
    const groupIndex = this.toolGroup === undefined ? -1 : children.indexOf(this.toolGroup);
    let group = this.toolGroup;
    let folded: tuiTypes.Component[];
    if (
      group !== undefined &&
      groupIndex >= 0 &&
      children.slice(groupIndex + 1).every(isFoldable)
    ) {
      folded = children.slice(groupIndex + 1);
    } else {
      group = new ToolGroupComponent(this.outputPad);
      group.setExpanded(this.toolOutputExpanded);
      const last = children.at(-1);
      folded = isFoldable(last) && last !== undefined ? [last] : [];
      if (last instanceof AssistantMessageComponent) {
        const thinking = last.takeThinking();
        if (thinking !== undefined) folded.push(thinking);
      }
      this.toolGroup = group;
    }
    for (const child of folded) this.chatContainer.removeChild(child);
    if (!children.includes(group)) this.chatContainer.addChild(group);
    for (const child of folded) group.items.addChild(child);
    group.items.addChild(component);
  }

  private addMessageToChat(
    message: agentTypes.AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    switch (message.role) {
      case "bashExecution": {
        const component = new BashExecutionComponent(
          message.command,
          this.ui,
          message.excludeFromContext,
          this.outputPad,
        );
        if (message.output !== "") {
          component.appendOutput(message.output);
        }
        component.setComplete(
          message.exitCode,
          message.cancelled,
          message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
          message.fullOutputPath,
        );
        this.chatContainer.addChild(component);
        break;
      }
      case "custom": {
        if (message.display) {
          const renderer =
            message.customType === ORCHESTRATOR_REPORT_MESSAGE_TYPE
              ? (createTaskReportRenderer(this.session.orchestrator) as MessageRenderer)
              : this.session.extensionRunner.getMessageRenderer(message.customType);
          const component = new CustomMessageComponent(
            message,
            renderer,
            this.getMarkdownThemeWithSettings(),
            this.outputPad,
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);
        }
        break;
      }
      case "compactionSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new CompactionSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
          this.outputPad,
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "branchSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new BranchSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
          this.outputPad,
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "system":
        break;
      case "user": {
        const textContent = this.getUserMessageText(message);
        if (textContent !== "") {
          if (this.chatContainer.children.length > 0) {
            this.chatContainer.addChild(new Spacer(1));
          }
          const skillBlock = parseSkillBlock(textContent);
          if (skillBlock === null) {
            const userComponent = new UserMessageComponent(
              textContent,
              this.getMarkdownThemeWithSettings(),
              this.outputPad,
              this.getMarkdownTransformers(),
            );
            this.chatContainer.addChild(userComponent);
          } else {
            const component = new SkillInvocationMessageComponent(
              skillBlock,
              this.getMarkdownThemeWithSettings(),
              this.outputPad,
            );
            component.setExpanded(this.toolOutputExpanded);
            this.chatContainer.addChild(component);
            if (skillBlock.userMessage !== undefined && skillBlock.userMessage !== "") {
              this.chatContainer.addChild(new Spacer(1));
              const userComponent = new UserMessageComponent(
                skillBlock.userMessage,
                this.getMarkdownThemeWithSettings(),
                this.outputPad,
                this.getMarkdownTransformers(),
              );
              this.chatContainer.addChild(userComponent);
            }
          }
          if (options?.populateHistory === true) {
            this.editor.addToHistory?.(textContent);
          }
        }
        break;
      }
      case "assistant": {
        const assistantComponent = new AssistantMessageComponent(
          message,
          this.hideThinkingBlock,
          this.getMarkdownThemeWithSettings(),
          this.hiddenThinkingLabel,
          this.outputPad,
          this.getMarkdownTransformers(),
        );
        this.chatContainer.addChild(assistantComponent);
        break;
      }
      case "toolResult": {
        break;
      }
      default:
        message satisfies never;
    }
  }

  private renderSessionItems(
    items: readonly RenderSessionItem[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    const { renderedPendingTools, cacheMisses } =
      InteractiveMode.renderSessionItemsRenderedPendingTools(this, options);

    for (const item of items) {
      if (isCustomSessionEntry(item)) {
        this.addCustomEntryToChat(item);
        continue;
      }
      if (isUsageSessionEntry(item)) {
        this.addCacheWarmingUsage(item);
        continue;
      }
      if (isCompactionCostNotice(item)) {
        this.addCompactionCostNotice(item);
        continue;
      }

      const message = item;
      if (message.role === "assistant") {
        this.addMessageToChat(message);
        for (const content of message.content) {
          if (content.type === "toolCall") {
            const component = new ToolExecutionComponent(
              content.name,
              content.id,
              content.arguments,
              {
                imageWidthCells: this.settingsManager.getImageWidthCells(),
                outputPad: this.outputPad,
                showImages: this.settingsManager.getShowImages(),
              },
              this.getRegisteredToolDefinition(content.name),
              this.ui,
              this.sessionManager.getCwd(),
            );
            component.setExpanded(this.toolOutputExpanded);
            this.addToolExecution(component);

            if (message.stopReason === "aborted" || message.stopReason === "error") {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.session.retryAttempt;
                errorMessage =
                  retryAttempt > 0
                    ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                    : "Operation aborted";
              } else {
                errorMessage = message.errorMessage || "Error";
              }
              component.updateResult({
                content: [{ text: errorMessage, type: "text" }],
                isError: true,
              });
            } else {
              renderedPendingTools.set(content.id, component);
            }
          }
        }
        if (message.stopReason !== "aborted" && message.stopReason !== "error") {
          const miss = cacheMisses.get(message);
          if (miss !== undefined) this.addCacheMissNotice(miss);
        }
      } else if (message.role === "toolResult") {
        const component = renderedPendingTools.get(message.toolCallId);
        if (component !== undefined) {
          component.updateResult(message);
          renderedPendingTools.delete(message.toolCallId);
        }
      } else {
        this.addMessageToChat(message, options);
      }
    }

    for (const [toolCallId, component] of renderedPendingTools) {
      this.pendingTools.set(toolCallId, component);
    }
    this.ui.requestRender();
  }

  private static renderSessionItemsRenderedPendingTools(
    self: InteractiveMode,
    options: { updateFooter?: boolean; populateHistory?: boolean },
  ): {
    renderedPendingTools: Map<string, ToolExecutionComponent>;
    cacheMisses: Map<compatTypes.AssistantMessage, CacheMiss>;
  } {
    self.pendingTools.clear();
    const renderedPendingTools = new Map<string, ToolExecutionComponent>();
    const cacheMisses = self.settingsManager.getShowCacheMissNotices()
      ? collectCacheMisses(self.sessionManager.getEntries(), self.session.modelRuntime)
      : new Map<compatTypes.AssistantMessage, CacheMiss>();

    if (options.updateFooter === true) {
      self.footer.invalidate();
      self.updateEditorBorderColor();
    }
    return { cacheMisses, renderedPendingTools };
  }

  private renderSessionEntries(
    entries: SessionEntry[],
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    if (this.renderer instanceof TuiAltScreen) this.renderer.resetTextSelection();
    const items = entries.flatMap((entry): RenderSessionItem[] => {
      if (entry.type === "custom" || (entry.type === "usage" && entry.kind === "cache_warm")) {
        return [entry];
      }
      const messages = sessionEntryToContextMessages(entry);
      if (
        (entry.type === "compaction" || entry.type === "branch_summary") &&
        entry.usage !== undefined &&
        messages.length > 0
      ) {
        return [...messages, { kind: entry.type, type: "compaction_cost", usage: entry.usage }];
      }
      return messages;
    });
    this.renderSessionItems(items, options);
  }

  private addCacheWarmingUsage(entry: UsageEntry): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;
    this.chatContainer.addChild(new Spacer(1));
    const usage = formatCacheWarmingUsage(entry);
    this.chatContainer.addChild(new ThemedText(() => theme.fg("dim", usage), 1, 0));
  }

  private addCompactionCostNotice(notice: CompactionCostNotice): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const { usage } = notice;
    const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const cost = usage.cost.total >= 0.01 ? ` (~$${usage.cost.total.toFixed(2)})` : "";
    const label = notice.kind === "compaction" ? "Compaction" : "Branch summary";
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `${label}: ${formatTokens(tokens)} tokens billed${cost}`),
        1,
        0,
      ),
    );
  }

  private static countDroppedThinkingBlocks(message: compatTypes.AssistantMessage): number {
    let count = 0;
    for (const diagnostic of message.diagnostics ?? []) {
      if (diagnostic.type !== "anthropic_input_transformations") continue;
      const transformations = diagnostic.details?.["transformations"];
      if (!Array.isArray(transformations)) continue;
      count += transformations.filter(
        (transformation) =>
          typeof transformation === "object" &&
          transformation !== null &&
          (transformation as Record<string, unknown>)["type"] === "thinking_dropped",
      ).length;
    }
    return count;
  }

  private maybeShowThinkingDropNotice(message: compatTypes.AssistantMessage): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const droppedCount = InteractiveMode.countDroppedThinkingBlocks(message);
    if (droppedCount === 0) return;

    let previousDroppedCount = 0;
    const branch = this.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type === "message" && entry.message.role === "assistant") {
        previousDroppedCount = InteractiveMode.countDroppedThinkingBlocks(entry.message);
        break;
      }
    }
    if (droppedCount <= previousDroppedCount) return;

    const noun = droppedCount === 1 ? "thinking block" : "thinking blocks";
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => theme.fg("warning", `Anthropic dropped ${droppedCount} ${noun} (details in session)`),
        1,
        0,
      ),
    );
  }

  private maybeShowCacheMissNotice(message: compatTypes.AssistantMessage): void {
    if (!this.settingsManager.getShowCacheMissNotices()) return;

    const miss = detectCacheMiss(
      this.sessionManager.getEntries(),
      message,
      this.session.modelRuntime,
    );
    if (miss !== undefined) this.addCacheMissNotice(miss);
  }

  private addCacheMissNotice(miss: CacheMiss): void {
    if (miss.missedTokens < 20_000 && miss.missedCost < 0.1) return;

    const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
    const reBilled = `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
    let label = "Cache miss";
    if (miss.modelChanged) {
      label = "Cache miss after model switch";
    } else if (miss.idleMs >= CACHE_TTL_MS) {
      label = `Cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
    }
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `${label}: ${reBilled}`), 1, 0),
    );
  }

  renderInitialMessages(): void {
    const entries = this.sessionManager.buildContextEntries();
    this.renderSessionEntries(entries, {
      populateHistory: true,
      updateFooter: true,
    });
    this.renderProjectTrustWarningIfNeeded();

    const allEntries = this.sessionManager.getEntries();
    const compactionCount = allEntries.filter((e) => e.type === "compaction").length;
    if (compactionCount > 0) {
      const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }
  }

  private renderProjectTrustWarningIfNeeded(): void {
    if (
      this.settingsManager.isProjectTrusted() ||
      !hasTrustRequiringProjectResources(this.sessionManager.getCwd())
    ) {
      return;
    }

    if (this.chatContainer.children.length > 0) {
      this.chatContainer.addChild(new Spacer(1));
    }
    this.chatContainer.addChild(
      new ThemedText(
        () =>
          theme.fg(
            "warning",
            `This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Use /trust to save a trust decision, then restart msa.`,
          ),
        1,
        0,
      ),
    );
  }

  getUserInput(): Promise<string> {
    return Effect.runPromise(
      Effect.suspend(() => {
        const queuedInput = this.pendingUserInputs.shift();
        if (queuedInput !== undefined) {
          return Effect.succeed(queuedInput);
        }

        return Effect.callback<string>((resume) => {
          this.onInputCallback = (text: string) => {
            this.onInputCallback = undefined;
            resume(Effect.succeed(text));
          };
        });
      }),
    );
  }

  private rebuildChatFromMessages(): void {
    this.chatContainer.clear();
    this.renderSessionEntries(this.sessionManager.buildContextEntries());
  }

  private handleCtrlC(): void {
    const now = nowMs();
    if (now - this.lastSigintTime < 500) {
      void void this.shutdown();
    } else {
      this.clearEditor();
      this.lastSigintTime = now;
    }
  }

  private handleCtrlD(): void {
    void void this.shutdown();
  }

  private isShuttingDown = false;

  private shutdown(options?: { fromSignal?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        if (options?.fromSignal === true) {
          yield* awaited(this.runtimeHost.dispose());
          this.themeController.disableAutoSync();
          yield* awaited(this.ui.terminal.drainInput(1000));
          this.stop();
          process.exit(0);
        }

        this.themeController.disableAutoSync();
        yield* awaited(this.ui.terminal.drainInput(1000));

        this.stop();
        yield* awaited(this.runtimeHost.dispose());

        const resumeCommand = formatResumeCommand(this.sessionManager);
        if (resumeCommand !== undefined && resumeCommand !== "") {
          process.stdout.write(`${chalk.dim("To resume this session:")} ${resumeCommand}\n`);
        }

        process.exit(0);
      }, this),
    );
  }

  private emergencyTerminalExit(): never {
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    killTrackedDetachedChildren();
    process.exit(129);
  }

  private uncaughtCrash(error: Error): never {
    if (isDeadTerminalError(error)) {
      this.emergencyTerminalExit();
    }
    if (this.isShuttingDown) {
      process.exit(1);
    }
    this.isShuttingDown = true;
    try {
      this.unregisterSignalHandlers();
    } catch {}
    try {
      killTrackedDetachedChildren();
    } catch {}
    try {
      this.ui.stop();
    } catch {}
    writeError(`${APP_NAME} exiting due to uncaughtException:`);
    writeError(error);
    const extensionHint = this.getCrashExtensionHint(error);
    if (extensionHint !== undefined && extensionHint !== "") writeError(`\n${extensionHint}`);
    if (this.recordCrash("uncaught_exception", error)) {
      writeError(`\n${this.crashReportInstructions()}`);
    }
    process.exit(1);
  }

  private checkShutdownRequested(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.shutdownRequested) return;
      yield* awaited(this.shutdown());
    }, this);
  }

  private registerSignalHandlers(): void {
    this.unregisterSignalHandlers();

    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }

    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void void this.shutdown({ fromSignal: true });
      };
      process.prependListener(signal, handler);
      this.signalCleanupHandlers.push(() => process.off(signal, handler));
    }

    const terminalErrorHandler = (error: Error) => {
      if (isDeadTerminalError(error)) {
        this.emergencyTerminalExit();
      }
      throw error;
    };
    for (const stream of [process.stdin, process.stdout, process.stderr]) {
      stream.on("error", terminalErrorHandler);
      this.signalCleanupHandlers.push(() => stream.off("error", terminalErrorHandler));
    }

    const uncaughtExceptionHandler = (error: Error) => this.uncaughtCrash(error);
    process.prependListener("uncaughtException", uncaughtExceptionHandler);
    this.signalCleanupHandlers.push(() =>
      process.off("uncaughtException", uncaughtExceptionHandler),
    );
  }

  private unregisterSignalHandlers(): void {
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
  }

  private handleCtrlZ(): void {
    if (process.platform === "win32") {
      this.showStatus("Suspend to background is not supported on Windows");
      return;
    }

    const suspendKeepAlive = schedule(() => {}, 2 ** 30);

    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);

    process.once("SIGCONT", () => {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      this.ui.start();
      this.ui.requestRender(true);
    });

    try {
      this.ui.stop();

      process.kill(0, "SIGTSTP");
    } catch (error) {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
  }

  private handleFollowUp(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const text = (this.editor.getExpandedText?.() ?? this.editor.getText()).trim();
      if (text === "") return;

      if (this.session.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          yield* awaited(this.session.prompt(text));
        } else {
          this.queueCompactionMessage(text, "followUp");
        }
        return;
      }

      if (this.session.isStreaming) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        yield* awaited(this.session.prompt(text, { streamingBehavior: "followUp" }));
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
      } else if (this.editor.onSubmit !== undefined) {
        this.editor.setText("");
        this.editor.onSubmit(text);
      }
    }, this);
  }

  private handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.showStatus("No queued messages to restore");
    } else {
      this.showStatus(`Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`);
    }
  }

  private updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = theme.getBashModeBorderColor();
    } else {
      const level = this.session.thinkingLevel || "off";
      this.editor.borderColor = theme.getThinkingBorderColor(level);
    }
    this.activeStatusIndicator?.invalidate();
    this.ui.requestRender();
  }

  private cycleThinkingLevel(): void {
    const newLevel = this.session.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.showStatus("Current model does not support thinking");
    } else {
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  private cycleModel(direction: "forward" | "backward"): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        const result = yield* awaited(this.session.cycleModel(direction));
        if (result === undefined) {
          const msg =
            this.session.scopedModels.length > 0
              ? "Only one model in scope"
              : "Only one model available";
          this.showStatus(msg);
        } else {
          this.footer.invalidate();
          this.updateEditorBorderColor();
          const thinkingStr =
            result.model.reasoning && result.thinkingLevel !== "off"
              ? ` (thinking: ${result.thinkingLevel})`
              : "";
          this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
        }
      } catch (error) {
        this.showError(toErrorMessage(error));
      }
    }, this);
  }

  private toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.toolOutputExpanded);
  }

  private setToolsExpanded(expanded: boolean): void {
    if (expanded === this.toolOutputExpanded) return;

    this.toolOutputExpanded = expanded;
    const activeHeader = this.customHeader ?? this.builtInHeader;
    if (isExpandable(activeHeader)) {
      activeHeader.setExpanded(expanded);
    }
    for (const container of [this.loadedResourcesContainer, this.chatContainer]) {
      for (const child of container.children) {
        if (isExpandable(child)) {
          child.setExpanded(expanded);
        }
      }
    }
    this.showStatus(`Tool output: ${expanded ? "expanded" : "collapsed"}`);
  }

  private updateThinkingBlockVisibility(): void {
    for (const child of this.chatComponents()) {
      if (child instanceof AssistantMessageComponent) {
        child.setHideThinkingBlock(this.hideThinkingBlock);
      }
    }
    this.ui.requestRender();
  }

  private toggleThinkingBlockVisibility(): void {
    this.hideThinkingBlock = !this.hideThinkingBlock;
    this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);
    this.updateThinkingBlockVisibility();
    this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
  }

  private handleOpenExternalEditor(): Effect.Effect<void> {
    return awaitingWith(function* () {
      const editorCmd = this.settingsManager.getExternalEditorCommand();
      const content = this.editor.getExpandedText?.() ?? this.editor.getText();
      this.ui.stop();
      try {
        const result = yield* awaited(
          editInExternalEditor({
            command: editorCmd,
            content,
          }),
        );
        if (result.status === "complete") {
          this.editor.setText(result.content);
        }
      } finally {
        this.ui.start();
        this.ui.requestRender(true);
      }
    }, this);
  }

  clearEditor(): void {
    this.editor.setText("");
    this.ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0),
    );
    this.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("warning", `Warning: ${warningMessage}`), 1, 0),
    );
    this.ui.requestRender();
  }

  showNewVersionNotification(release: LatestMsaRelease): void {
    const updateInstruction = () =>
      theme.fg("muted", `New version ${release.version} is available. Run `) +
      theme.fg("accent", `${APP_NAME} update`);
    const changelogUrl = RELEASES_URL;
    const changelogLine = () => {
      const changelogLink = getCapabilities().hyperlinks
        ? hyperlink(theme.fg("accent", changelogUrl), changelogUrl)
        : theme.fg("accent", changelogUrl);
      return theme.fg("muted", "Changelog: ") + changelogLink;
    };

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new ThemedText(
        () => `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction()}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(new ThemedText(changelogLine, 1, 0));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }

  showPackageUpdateNotification(packages: string[]): void {
    const updateInstruction = () =>
      theme.fg("muted", "Package updates are available. Run ") +
      theme.fg("accent", `${APP_NAME} update --extensions`);
    const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.chatContainer.addChild(
      new ThemedText(
        () =>
          `${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction()}\n${theme.fg("muted", "Packages:")}\n${packageLines}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
    this.ui.requestRender();
  }

  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
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

  private clearAllQueues(): { steering: string[]; followUp: string[] } {
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

  private updatePendingMessagesDisplay(): void {
    this.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } = this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = keyDisplayText("app.message.dequeue");
      const hintText = theme.fg("dim", `↳ ${dequeueHint} to edit all queued messages`);
      this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  private restoreQueuedMessagesToEditor(options?: {
    abort?: boolean;
    currentText?: string;
  }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort === true) {
        void this.session.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.editor.getText();
    const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
    this.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort === true) {
      void this.session.abort();
    }
    return allQueued.length;
  }

  private queueCompactionMessage(text: string, mode: "steer" | "followUp"): void {
    this.compactionQueuedMessages.push({ mode, text });
    this.editor.addToHistory?.(text);
    this.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.showStatus("Queued message for after compaction");
  }

  private isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.session.extensionRunner;

    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return extensionRunner.getCommand(commandName) !== undefined;
  }

  private flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.compactionQueuedMessages.length === 0) {
          return;
        }

        const { queuedMessages, restoreQueue } =
          InteractiveMode.flushCompactionQueueQueuedMessages(this);

        const flushCompactionQueuePart12Result = yield* performed(
          InteractiveMode.flushCompactionQueuePart12(this, options, queuedMessages, restoreQueue),
        );
        if (flushCompactionQueuePart12Result.done) return flushCompactionQueuePart12Result.value;
      }, this),
    );
  }

  private static flushCompactionQueuePart12(
    self: InteractiveMode,
    options: { willRetry?: boolean } | undefined,
    queuedMessages: CompactionQueuedMessage[],
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{ done: true; value: void } | { done: false; value: void }> {
    return awaiting(function* () {
      try {
        if (options?.willRetry === true) {
          for (const message of queuedMessages) {
            if (self.isExtensionCommand(message.text)) {
              yield* awaited(self.session.prompt(message.text));
            } else if (message.mode === "followUp") {
              yield* awaited(self.session.followUp(message.text));
            } else {
              yield* awaited(self.session.steer(message.text));
            }
          }
          self.updatePendingMessagesDisplay();
          return { done: true, value: undefined };
        }

        const firstPromptIndex = queuedMessages.findIndex(
          (message) => !self.isExtensionCommand(message.text),
        );
        const firstPrompt = queuedMessages[firstPromptIndex];
        if (firstPrompt === undefined) {
          for (const message of queuedMessages) {
            yield* awaited(self.session.prompt(message.text));
          }
          return { done: true, value: undefined };
        }

        yield* performed(
          InteractiveMode.flushCompactionQueuePart1(
            self,
            queuedMessages,
            firstPromptIndex,
            firstPrompt,
            restoreQueue,
          ),
        );
      } catch (error) {
        restoreQueue(error);
      }
      return { done: false, value: undefined };
    });
  }

  private static flushCompactionQueuePart1(
    self: InteractiveMode,
    queuedMessages: CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<void> {
    return awaiting(function* () {
      const { rest, promptPromise } = yield* performed(
        InteractiveMode.flushCompactionQueueRest(
          self,
          queuedMessages,
          firstPromptIndex,
          firstPrompt,
          restoreQueue,
        ),
      );

      yield* performed(InteractiveMode.flushCompactionQueuePart3(self, rest, promptPromise));
    });
  }

  private static flushCompactionQueueQueuedMessages(self: InteractiveMode): {
    queuedMessages: CompactionQueuedMessage[];
    restoreQueue: (error: unknown) => void;
  } {
    const queuedMessages = [...self.compactionQueuedMessages];
    self.compactionQueuedMessages = [];
    self.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      self.session.clearQueue();
      self.compactionQueuedMessages = queuedMessages;
      self.updatePendingMessagesDisplay();
      self.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${toErrorMessage(
          error,
        )}`,
      );
    };
    return { queuedMessages, restoreQueue };
  }

  private static flushCompactionQueueRest(
    self: InteractiveMode,
    queuedMessages: CompactionQueuedMessage[],
    firstPromptIndex: number,
    firstPrompt: CompactionQueuedMessage,
    restoreQueue: (error: unknown) => void,
  ): Effect.Effect<{ rest: CompactionQueuedMessage[]; promptPromise: Promise<void> }> {
    return awaiting(function* () {
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        yield* awaited(self.session.prompt(message.text));
      }

      const promptPromise = self.session
        .prompt(firstPrompt.text, { streamingBehavior: firstPrompt.mode })
        .catch((error) => {
          restoreQueue(error);
        });
      return { promptPromise, rest };
    });
  }

  private static flushCompactionQueuePart3(
    self: InteractiveMode,
    rest: CompactionQueuedMessage[],
    promptPromise: Promise<void>,
  ): Effect.Effect<void> {
    return awaiting(function* () {
      for (const message of rest) {
        if (self.isExtensionCommand(message.text)) {
          yield* awaited(self.session.prompt(message.text));
        } else if (message.mode === "followUp") {
          yield* awaited(self.session.followUp(message.text));
        } else {
          yield* awaited(self.session.steer(message.text));
        }
      }
      self.updatePendingMessagesDisplay();
      void promptPromise;
    });
  }

  private flushPendingBashComponents(): void {
    for (const component of this.pendingBashComponents) {
      this.pendingMessagesContainer.removeChild(component);
      this.chatContainer.addChild(component);
    }
    this.pendingBashComponents = [];
  }

  private showSettingsSelector(): void {
    this.editorSlot.showSelector((done) => {
      const { defaultModel } = InteractiveMode.showSettingsSelectorSelector(this);
      let selector: SettingsSelectorComponent | undefined;
      selector = new SettingsSelectorComponent(
        {
          autoCompact: this.session.autoCompactionEnabled,
          autoResizeImages: this.settingsManager.getImageAutoResize(),
          autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
          availableDefaultModels: this.session.modelRuntime.getAvailableSnapshot(),
          availableThemes: getAvailableThemes(),
          availableThinkingLevels: [...THINKING_LEVEL_OPTIONS],
          blockImages: this.settingsManager.getBlockImages(),
          cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
          clearOnShrink: this.settingsManager.getClearOnShrink(),
          collapseChangelog: this.settingsManager.getCollapseChangelog(),
          currentModel: this.session.model,
          currentTheme: this.themeController.getThemeSelection() || SYSTEM_THEME_NAME,
          defaultModel,
          defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
          doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
          editorPaddingX: this.settingsManager.getEditorPaddingX(),
          enableInstallTelemetry: this.settingsManager.getEnableInstallTelemetry(),
          enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
          followUpMode: this.session.followUpMode,
          fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
          fullscreenExitOutput: this.settingsManager.getFullscreenExitOutput(),
          fullscreenScrollbar: this.settingsManager.getFullscreenScrollbar(),
          fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
          hideThinkingBlock: this.hideThinkingBlock,
          httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
          imageWidthCells: this.settingsManager.getImageWidthCells(),
          mermaidRenderingMode: this.settingsManager.getMermaidRenderingMode(),
          modelThinkingLevels: this.settingsManager.getAllModelThinkingLevels(),
          outputPad: this.settingsManager.getOutputPad(),
          quietStartup: this.settingsManager.getQuietStartup(),
          showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
          showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
          showImages: this.settingsManager.getShowImages(),
          showTerminalProgress: this.settingsManager.getShowTerminalProgress(),
          steeringMode: this.session.steeringMode,
          terminalTheme: this.themeController.getTerminalTheme(),
          thinkingLevel: this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
          transport: this.settingsManager.getTransport(),
          treeFilterMode: this.settingsManager.getTreeFilterMode(),
          tuiMode: this.ui.mode,
        },
        {
          onAutoCompactChange: (enabled) => {
            this.session.setAutoCompactionEnabled(enabled);
            this.footer.setAutoCompactEnabled(enabled);
          },
          onAutoResizeImagesChange: (enabled) => {
            this.settingsManager.setImageAutoResize(enabled);
          },
          onAutocompleteMaxVisibleChange: (maxVisible) => {
            this.settingsManager.setAutocompleteMaxVisible(maxVisible);
            this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
            if (
              this.editor !== this.defaultEditor &&
              this.editor.setAutocompleteMaxVisible !== undefined
            ) {
              this.editor.setAutocompleteMaxVisible(maxVisible);
            }
          },
          onBlockImagesChange: (blocked) => {
            this.settingsManager.setBlockImages(blocked);
          },
          onCacheWarmingModeChange: (mode) => {
            this.session.setCacheWarmingMode(mode);
            this.showStatus(`Cache warming: ${mode}`);
          },
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
          onClearOnShrinkChange: (enabled) => {
            this.settingsManager.setClearOnShrink(enabled);
            this.ui.setClearOnShrink(enabled);
            if (!enabled && this.activeStatusIndicator === undefined) {
              this.statusContainer.clear();
            }
          },
          onCollapseChangelogChange: (collapsed) => {
            this.settingsManager.setCollapseChangelog(collapsed);
          },
          onDefaultProjectTrustChange: (defaultProjectTrust) => {
            this.settingsManager.setDefaultProjectTrust(defaultProjectTrust);
          },
          onDoubleEscapeActionChange: (action) => {
            this.settingsManager.setDoubleEscapeAction(action);
          },
          onEditorPaddingXChange: (padding) => {
            this.settingsManager.setEditorPaddingX(padding);
            this.defaultEditor.setPaddingX(padding);
            if (this.editor !== this.defaultEditor && this.editor.setPaddingX !== undefined) {
              this.editor.setPaddingX(padding);
            }
          },
          onEnableInstallTelemetryChange: (enabled) => {
            this.settingsManager.setEnableInstallTelemetry(enabled);
          },
          onEnableSkillCommandsChange: (enabled) => {
            this.settingsManager.setEnableSkillCommands(enabled);
            this.setupAutocompleteProvider();
          },
          onFollowUpModeChange: (mode) => {
            this.session.setFollowUpMode(mode);
          },
          onFullscreenCopyOnSelectChange: (enabled) => {
            this.settingsManager.setFullscreenCopyOnSelect(enabled);
            if (this.renderer instanceof TuiAltScreen) this.renderer.setCopyOnSelect(enabled);
          },
          onFullscreenExitOutputChange: (output) => {
            this.settingsManager.setFullscreenExitOutput(output);
          },
          onFullscreenScrollbarChange: (mode) => {
            this.settingsManager.setFullscreenScrollbar(mode);
            this.applyFullscreenScrollbarSetting();
          },
          onFullscreenWheelScrollLinesChange: (lines) => {
            this.settingsManager.setFullscreenWheelScrollLines(lines);
            if (this.renderer instanceof TuiAltScreen) this.renderer.setWheelScrollLines(lines);
          },
          onHideThinkingBlockChange: (hidden) => {
            this.hideThinkingBlock = hidden;
            this.settingsManager.setHideThinkingBlock(hidden);
            this.updateThinkingBlockVisibility();
          },
          onHttpIdleTimeoutMsChange: (timeoutMs) => {
            this.settingsManager.setHttpIdleTimeoutMs(timeoutMs);
            configureHttpDispatcher(timeoutMs);
            this.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
          },
          onImageWidthCellsChange: (width) => {
            this.settingsManager.setImageWidthCells(width);
            for (const child of this.chatComponents()) {
              if (child instanceof ToolExecutionComponent) {
                child.setImageWidthCells(width);
              }
            }
          },
          onMermaidRenderingModeChange: (mode) => {
            this.settingsManager.setMermaidRenderingMode(mode);
            this.chatContainer.invalidate();
            this.ui.requestRender();
          },
          onModelThinkingLevelChange: (provider, modelId, level) => {
            this.settingsManager.setModelThinkingLevel(provider, modelId, level);
            const current = this.session.model;
            if (current !== undefined && current.provider === provider && current.id === modelId) {
              this.session.setThinkingLevel(level);
              this.footer.invalidate();
              this.updateEditorBorderColor();
            }
          },
          onModelThinkingLevelRemove: (provider, modelId) => {
            this.settingsManager.removeModelThinkingLevel(provider, modelId);
            const current = this.session.model;
            if (current !== undefined && current.provider === provider && current.id === modelId) {
              const globalDefault =
                this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
              this.session.setThinkingLevel(globalDefault);
              this.footer.invalidate();
              this.updateEditorBorderColor();
            }
          },
          onOutputPadChange: (padding) => {
            this.settingsManager.setOutputPad(padding);
            this.outputPad = padding;
            for (const children of [
              this.chatComponents(),
              this.pendingMessagesContainer.children,
            ]) {
              for (const child of children) {
                if ("setOutputPad" in child && typeof child.setOutputPad === "function") {
                  child.setOutputPad(padding);
                }
              }
            }
            this.ui.requestRender();
          },
          onQuietStartupChange: (quiet) => {
            this.settingsManager.setQuietStartup(quiet);
          },
          onShowCacheMissNoticesChange: (shown) => {
            this.settingsManager.setShowCacheMissNotices(shown);
            this.rebuildChatFromMessages();
          },
          onShowHardwareCursorChange: (enabled) => {
            this.settingsManager.setShowHardwareCursor(enabled);
            this.ui.setShowHardwareCursor(enabled);
          },
          onShowImagesChange: (enabled) => {
            this.settingsManager.setShowImages(enabled);
            for (const child of this.chatComponents()) {
              if (child instanceof ToolExecutionComponent) {
                child.setShowImages(enabled);
              }
            }
          },
          onShowTerminalProgressChange: (enabled) => {
            this.settingsManager.setShowTerminalProgress(enabled);
          },
          onSteeringModeChange: (mode) => {
            this.session.setSteeringMode(mode);
          },
          onThemeChange: (themeSetting) => {
            this.settingsManager.setTheme(themeSetting);
            this.themeController.setThemeSetting(themeSetting);
          },
          onThemePreview: (themeName) => this.themeController.preview(themeName),
          onTransportChange: (transport) => {
            this.settingsManager.setTransport(transport);
            this.session.agent.transport = transport;
          },
          onTreeFilterModeChange: (mode) => {
            this.settingsManager.setTreeFilterMode(mode);
          },
          onTuiModeChange: (mode) => {
            if (!this.switchTuiMode(mode)) {
              selector?.getSettingsList().updateValue("tui-mode", this.ui.mode);
              this.showStatus("Close active overlays before changing TUI mode");
              return;
            }
            this.settingsManager.setTuiMode(mode);
            if (this.activeStatusIndicator === undefined) this.statusContainer.clear();
            this.showStatus(`TUI mode: ${mode}`);
          },
        },
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }

  private static showSettingsSelectorSelector(self: InteractiveMode): {
    defaultModel: string;
  } {
    const defaultProvider = self.settingsManager.getDefaultProvider();
    const defaultModelId = self.settingsManager.getDefaultModel();
    const defaultModel =
      defaultProvider !== undefined &&
      defaultProvider !== "" &&
      defaultModelId !== undefined &&
      defaultModelId !== ""
        ? `${defaultProvider}/${defaultModelId}`
        : "not set";
    return { defaultModel };
  }

  private handleThinkingCommand(searchTerm?: string): void {
    const availableLevels = this.session.getAvailableThinkingLevels();
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

  private selectThinkingLevel(level: agentTypes.ThinkingLevel, persist: boolean): void {
    try {
      this.session.setThinkingLevel(level, { persist });
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(persist ? `Default thinking level: ${level}` : `Thinking level: ${level}`);
    } catch (error) {
      this.showError(toErrorMessage(error));
    }
  }

  private showThinkingSelector(): void {
    this.editorSlot.showSelector((done) => {
      const selectLevel = (level: agentTypes.ThinkingLevel, persist: boolean) => {
        this.selectThinkingLevel(level, persist);
        done();
      };
      const selector = new ThinkingSelectorComponent(
        this.session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        this.session.getAvailableThinkingLevels(),
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

  private handleModelCommand(searchTerm?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (searchTerm === undefined || searchTerm === "") {
        this.showModelSelector();
        return;
      }
      if (searchTerm === "upgrade") {
        this.showModelUpgradeSelector();
        return;
      }

      const model = yield* awaited(this.findExactModelMatch(searchTerm));
      if (model !== undefined) {
        try {
          yield* awaited(this.session.setModel(model, { persist: false }));
          this.footer.invalidate();
          this.updateEditorBorderColor();
          this.showStatus(`Model: ${model.id}`);
        } catch (error) {
          this.showError(toErrorMessage(error));
        }
        return;
      }

      const denial = findModelPolicyDenial({
        catalogModels: this.session.modelRuntime.getCatalogModels(),
        policy: this.session.modelRuntime.getModelPolicy(),
        reference: searchTerm,
      });
      if (denial !== undefined) {
        this.showError(formatModelPolicyDenialError(denial));
        return;
      }

      this.showModelSelector(searchTerm);
    }, this);
  }

  private showModelUpgradeSelector(): void {
    const candidates = findModelUpgrades(this.session.modelRuntime.getCatalogModels());
    const plan = planModelUpgrades({
      candidates,
      layers: {
        global: this.settingsManager.getGlobalSettings(),
        project: this.settingsManager.getProjectSettings(),
      },
    });
    const named = candidatesNamedByChanges(candidates, plan.changes);
    const shown = named.length > 0 ? named : candidates.filter((entry) => entry.confident);
    if (shown.length === 0) {
      this.showStatus("No model upgrades found");
      return;
    }
    this.editorSlot.showSelector((done) => {
      const component = new ModelUpgradeSelectorComponent(shown, {
        onApply: (candidate) =>
          Effect.runPromise(
            awaitingWith(function* () {
              const replacements = createUpgradeReplacements([candidate]);
              const written = this.settingsManager.rewriteModelReferences((layer) =>
                rewriteModelReferencesInSettings(layer, replacements),
              );
              yield* awaited(this.settingsManager.flush());
              const count = written.global.length + written.project.length;
              this.footer.invalidate();
              return count === 0
                ? `${candidate.from.id} → ${candidate.to.id} · no setting names it`
                : `${candidate.from.id} → ${candidate.to.id} · ${count} setting${count === 1 ? "" : "s"}`;
            }, this),
          ),
        onCancel: () => {
          done();
          this.ui.requestRender();
        },
        requestRender: () => this.ui.requestRender(),
      });
      return { component, dispose: () => {}, focus: component };
    });
  }

  private findExactModelMatch(searchTerm: string): Promise<compatTypes.Model<any> | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const cachedModels =
          this.session.scopedModels.length > 0
            ? this.session.scopedModels.map((scoped) => scoped.model)
            : [...this.session.modelRuntime.getAvailableSnapshot()];
        const cachedMatch = findExactModelReferenceMatch(searchTerm, cachedModels);
        if (cachedMatch !== undefined || this.session.scopedModels.length > 0) return cachedMatch;

        this.showStatus("Refreshing model catalogs…");
        const controller = new AbortController();
        let timedOut = false;
        const timeout = schedule(() => {
          timedOut = true;
          controller.abort();
        }, 15_000);
        try {
          const result = yield* awaited(
            refreshModelCatalogs(this.session.modelRuntime, controller.signal),
          );
          if (result.aborted && timedOut) {
            this.showWarning("Model refresh timed out; searching cached models.");
          } else if (result.errors.size > 0) {
            this.showWarning(
              `Could not refresh ${[...result.errors.keys()].join(", ")}; searching cached models.`,
            );
          }
        } catch (error) {
          this.showWarning(
            timedOut
              ? "Model refresh timed out; searching cached models."
              : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
          );
        } finally {
          timeout.cancel();
        }
        return findExactModelReferenceMatch(searchTerm, [
          ...this.session.modelRuntime.getAvailableSnapshot(),
        ]);
      }, this),
    );
  }

  private updateAvailableProviderCount(): void {
    const models =
      this.session.scopedModels.length > 0
        ? this.session.scopedModels.map((scoped) => scoped.model)
        : this.session.modelRuntime.getAvailableSnapshot();
    const uniqueProviders = new Set(models.map((model) => model.provider));
    this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  private maybeSaveImplicitProjectTrustAfterReload(): boolean {
    const cwd = this.sessionManager.getCwd();
    if (this.autoTrustOnReloadCwd !== cwd) {
      return false;
    }
    if (!this.settingsManager.isProjectTrusted() || !hasTrustRequiringProjectResources(cwd)) {
      return false;
    }

    const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
    try {
      if (trustStore.get(cwd) !== null) {
        this.autoTrustOnReloadCwd = undefined;
        return false;
      }
      trustStore.set(cwd, true);
      this.autoTrustOnReloadCwd = undefined;
      return true;
    } catch (error) {
      this.showWarning(`Could not save project trust after reload: ${toErrorMessage(error)}`);
      return false;
    }
  }

  private showTrustSelector(): void {
    const cwd = this.sessionManager.getCwd();
    const trustStore = new ProjectTrustStore(this.runtimeHost.services.agentDir);
    const savedDecision = trustStore.getEntry(cwd);
    this.editorSlot.showSelector((done) => {
      const selector = new TrustSelectorComponent({
        cwd,
        onCancel: () => {
          done();
          this.ui.requestRender();
        },
        onSelect: (selection) => {
          trustStore.setMany(selection.updates);
          done();
          this.showStatus(
            `Saved trust decision: ${selection.trusted ? "trusted" : "untrusted"}. Restart ${APP_NAME} for this to take effect.`,
          );
        },
        projectTrusted: this.settingsManager.isProjectTrusted(),
        savedDecision,
      });
      return { component: selector, focus: selector };
    });
  }

  private showModelSelector(initialSearchInput?: string): void {
    this.editorSlot.showSelector((done) => {
      const selectModel = (model: compatTypes.Model<any>, persist: boolean) =>
        Effect.runPromise(
          awaitingWith(function* () {
            try {
              yield* awaited(this.session.setModel(model, { persist }));
              this.updateAvailableProviderCount();
              this.footer.invalidate();
              this.updateEditorBorderColor();
              done();
              this.showStatus(
                persist ? `Default model: ${model.provider}/${model.id}` : `Model: ${model.id}`,
              );
            } catch (error) {
              done();
              this.showError(toErrorMessage(error));
            }
          }, this),
        );
      const defaultProvider = this.settingsManager.getDefaultProvider();
      const defaultModel = this.settingsManager.getDefaultModel();
      const selector = new ModelSelectorComponent(
        this.ui,
        this.session.model,
        this.session.modelRuntime,
        this.session.scopedModels,
        (model) => selectModel(model, false),
        () => {
          done();
          this.ui.requestRender();
        },
        initialSearchInput,
        (model) => selectModel(model, true),
        defaultProvider !== undefined &&
          defaultProvider !== "" &&
          defaultModel !== undefined &&
          defaultModel !== ""
          ? { id: defaultModel, provider: defaultProvider }
          : undefined,
        {
          getCatalogModels: () => this.session.modelRuntime.getCatalogModels(),
          getPolicy: () => this.session.modelRuntime.getModelPolicy(),
          savePolicy: (policy) =>
            saveModelPolicy(
              {
                settingsManager: this.settingsManager,
                modelRuntime: this.session.modelRuntime,
              },
              policy,
            ),
        },
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }

  private showModelsSelector(): void {
    let {
      currentEnabledIds,
      availableModelIds,
      availableModels,
      selectionChanged,
      sessionScopedModels,
      configuredEnabledIds,
    } = InteractiveMode.showModelsSelectorCurrentEnabledIds(this);

    const updateSessionModels = (enabledIds: string[] | null): void => {
      currentEnabledIds = enabledIds === null ? null : [...enabledIds];
      const hasEnabledAvailableModel = enabledIds?.some((id) => availableModelIds.has(id)) ?? false;
      const allAvailableModelsEnabled =
        enabledIds !== null && [...availableModelIds].every((id) => enabledIds.includes(id));
      if (enabledIds !== null && hasEnabledAvailableModel && !allAvailableModelsEnabled) {
        const newScopedModels = resolveModelScopeFromModels(
          enabledIds,
          availableModels,
        ).scopedModels;
        this.session.setScopedModels(
          newScopedModels.map((scoped) => ({
            model: scoped.model,
            thinkingLevel: scoped.thinkingLevel,
          })),
        );
      } else {
        this.session.setScopedModels([]);
      }
      this.updateAvailableProviderCount();
      this.ui.requestRender();
    };

    this.editorSlot.showSelector((done) => {
      let disposed = false;
      let timedOut = false;
      const controller = new AbortController();
      const timeout = schedule(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      const selector = new ScopedModelsSelectorComponent(
        {
          allModels: availableModels,
          enabledModelIds: currentEnabledIds,
          refreshStatus: "Refreshing model catalogs…",
        },
        {
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
          onChange: (enabledIds) => {
            selectionChanged = true;
            updateSessionModels(enabledIds);
          },
          onPersist: (enabledIds) => {
            const allEnabled =
              enabledIds !== null &&
              enabledIds.length === availableModels.length &&
              enabledIds.every((id) => availableModelIds.has(id));
            const newPatterns = enabledIds === null || allEnabled ? undefined : enabledIds;
            this.settingsManager.setEnabledModels(
              newPatterns === undefined ? undefined : [...newPatterns],
            );
            this.showStatus("Model selection saved to settings");
          },
        },
      );
      Effect.runFork(
        awaitingWith(function* () {
          try {
            const result = yield* awaited(
              refreshModelCatalogs(this.session.modelRuntime, controller.signal),
            );
            if (disposed) return;
            availableModels = [...this.session.modelRuntime.getAvailableSnapshot()];
            availableModelIds = new Set(
              availableModels.map((model) => `${model.provider}/${model.id}`),
            );
            if (!selectionChanged && sessionScopedModels.length === 0) {
              currentEnabledIds = configuredEnabledIds(availableModels);
              selector.updateModels(availableModels, currentEnabledIds);
            } else {
              selector.updateModels(availableModels);
            }
            if (currentEnabledIds !== null) updateSessionModels(currentEnabledIds);
            if (result.aborted && timedOut) {
              selector.setRefreshStatus(
                "Model refresh timed out; showing cached models.",
                "warning",
              );
            } else if (result.errors.size > 0) {
              selector.setRefreshStatus(
                `Could not refresh ${[...result.errors.keys()].join(", ")}; showing cached models.`,
                "warning",
              );
            } else {
              selector.setRefreshStatus("Model catalogs refreshed.", "success");
            }
            this.ui.requestRender();
          } catch (error: unknown) {
            if (disposed) return;
            selector.setRefreshStatus(
              timedOut
                ? "Model refresh timed out; showing cached models."
                : `Could not refresh model catalogs: ${toErrorMessage(error)}`,
              "warning",
            );
            this.ui.requestRender();
          } finally {
            timeout.cancel();
          }
        }, this),
      );
      return {
        component: selector,
        dispose: () => {
          disposed = true;
          timeout.cancel();
          controller.abort();
        },
        focus: selector,
      };
    });
  }

  private static showModelsSelectorCurrentEnabledIds(self: InteractiveMode): {
    currentEnabledIds: string[] | null;
    availableModelIds: Set<string>;
    availableModels: compatTypes.Model<aiTypes.Api>[];
    selectionChanged: boolean;
    sessionScopedModels: readonly {
      model: compatTypes.Model<any>;
      thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    }[];
    configuredEnabledIds: (models: readonly compatTypes.Model<any>[]) => string[] | null;
  } {
    let availableModels = [...self.session.modelRuntime.getAvailableSnapshot()];
    let availableModelIds = new Set(
      availableModels.map((model) => `${model.provider}/${model.id}`),
    );
    const configuredPatterns = self.settingsManager.getEnabledModels();
    const sessionScopedModels = self.session.scopedModels;
    const configuredEnabledIds = (models: readonly compatTypes.Model<any>[]): string[] | null => {
      if (configuredPatterns?.length === undefined || configuredPatterns?.length === 0) return null;
      const resolved = resolveModelScopeFromModels(configuredPatterns, models);
      const ids = resolved.scopedModels.map(
        (scoped) => `${scoped.model.provider}/${scoped.model.id}`,
      );
      for (const diagnostic of resolved.diagnostics) {
        if (diagnostic.code === "no-match" && !ids.includes(diagnostic.pattern))
          ids.push(diagnostic.pattern);
      }
      return ids;
    };

    let currentEnabledIds =
      sessionScopedModels.length > 0
        ? sessionScopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)
        : configuredEnabledIds(availableModels);
    let selectionChanged = false;
    return {
      availableModelIds,
      availableModels,
      configuredEnabledIds,
      currentEnabledIds,
      selectionChanged,
      sessionScopedModels,
    };
  }

  private showUserMessageSelector(): void {
    const userMessages = this.session.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.showStatus("No messages to fork from");
      return;
    }

    const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

    this.editorSlot.showSelector((done) => {
      const selector = new UserMessageSelectorComponent(
        userMessages.map((m) => ({ id: m.entryId, text: m.text })),
        (entryId) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              try {
                const result = yield* awaited(this.runtimeHost.fork(entryId));
                if (result.cancelled) {
                  this.ui.requestRender();
                  return;
                }

                this.editor.setText(result.selectedText ?? "");
                this.showStatus("Forked to new session");
              } catch (error: unknown) {
                this.showError(toErrorMessage(error));
              }
            }, this),
          ),
        () => {
          done();
          this.ui.requestRender();
        },
        initialSelectedId,
      );
      return { component: selector, focus: selector.getMessageList() };
    });
  }

  private handleCloneCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const leafId = this.sessionManager.getLeafId();
        if (leafId === null || leafId === "") {
          this.showStatus("Nothing to clone yet");
          return;
        }

        try {
          const result = yield* awaited(this.runtimeHost.fork(leafId, { position: "at" }));
          if (result.cancelled) {
            this.ui.requestRender();
            return;
          }

          this.editor.setText("");
          this.showStatus("Cloned to new session");
        } catch (error: unknown) {
          this.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  private showTreeSelector(initialSelectedId?: string): void {
    const tree = this.sessionManager.getTree();
    const realLeafId = this.sessionManager.getLeafId();
    const initialFilterMode = this.settingsManager.getTreeFilterMode();

    if (tree.length === 0) {
      this.showStatus("No entries in session");
      return;
    }

    this.editorSlot.showSelector((done) => {
      const selector = new TreeSelectorComponent(
        tree,
        realLeafId,
        this.ui.terminal.rows,
        (entryId) =>
          Effect.runPromise(
            awaitingWith(function* () {
              if (entryId === this.sessionManager.getLeafId()) {
                done();
                this.showStatus("Already at this point");
                return;
              }

              done();

              let wantsSummary = false;
              let customInstructions: string | undefined;

              if (!this.settingsManager.getBranchSummarySkipPrompt()) {
                while (true) {
                  const summaryChoice = yield* awaited(
                    this.extensionDialogs.select("Summarize branch?", [
                      "No summary",
                      "Summarize",
                      "Summarize with custom prompt",
                    ]),
                  );

                  if (summaryChoice === undefined) {
                    this.showTreeSelector(entryId);
                    return;
                  }

                  wantsSummary = summaryChoice !== "No summary";

                  if (summaryChoice === "Summarize with custom prompt") {
                    customInstructions = yield* awaited(
                      this.extensionDialogs.editor("Custom summarization instructions"),
                    );
                    if (customInstructions === undefined) {
                      continue;
                    }
                  }

                  break;
                }
              }

              if (this.session.isStreaming) {
                this.restoreQueuedMessagesToEditor();
                yield* awaited(this.session.abort());
              }

              if (this.session.isCompacting) {
                this.showError(
                  "Wait for the current compaction or tree navigation to finish before navigating the session tree.",
                );
                return;
              }

              let { showingSummaryIndicator, originalOnEscape } =
                InteractiveMode.showTreeSelectorShowingSummaryIndicator(this, wantsSummary);

              try {
                const result = yield* awaited(
                  this.session.navigateTree(entryId, {
                    customInstructions,
                    summarize: wantsSummary,
                  }),
                );

                if (result.aborted === true) {
                  this.showStatus("Branch summarization cancelled");
                  this.showTreeSelector(entryId);
                  return;
                }
                if (result.cancelled) {
                  this.showStatus("Navigation cancelled");
                  return;
                }

                this.chatContainer.clear();
                this.renderInitialMessages();
                if (
                  result.editorText !== undefined &&
                  result.editorText !== "" &&
                  this.editor.getText().trim() === ""
                ) {
                  this.editor.setText(result.editorText);
                }
                this.showStatus("Navigated to selected point");
                void void this.flushCompactionQueue({ willRetry: false });
              } catch (error) {
                this.showError(toErrorMessage(error));
              } finally {
                if (showingSummaryIndicator) {
                  this.clearStatusIndicator("branchSummary");
                }
                this.defaultEditor.onEscape = originalOnEscape;
              }
            }, this),
          ),
        () => {
          done();
          this.ui.requestRender();
        },
        (entryId, label) => {
          this.sessionManager.appendLabelChange(entryId, label);
          this.ui.requestRender();
        },
        initialSelectedId,
        initialFilterMode,
      );
      selector.onCopy = (text) =>
        Effect.runPromise(
          awaitingWith(function* () {
            if (text === undefined || text === "") {
              this.showError("Selected entry has no text to copy");
              return;
            }
            try {
              yield* awaited(copyToClipboard(text));
              this.showStatus("Copied selected message to clipboard");
            } catch (error) {
              this.showError(toErrorMessage(error));
            }
          }, this),
        );
      return { component: selector, focus: selector };
    });
  }

  private static showTreeSelectorShowingSummaryIndicator(
    self: InteractiveMode,
    wantsSummary: boolean,
  ): { showingSummaryIndicator: boolean; originalOnEscape: (() => void) | undefined } {
    let showingSummaryIndicator = false;
    const originalOnEscape = self.defaultEditor.onEscape;

    if (wantsSummary) {
      self.defaultEditor.onEscape = () => {
        self.session.abortBranchSummary();
      };
      self.chatContainer.addChild(new Spacer(1));
      self.showStatusIndicator(new BranchSummaryStatusIndicator(self.ui));
      showingSummaryIndicator = true;
      self.ui.requestRender();
    }
    return { originalOnEscape, showingSummaryIndicator };
  }

  private showTasksView(initialId?: string): void {
    const orchestrator = this.session.orchestrator;
    if (orchestrator === undefined) {
      this.showStatus("The orchestrator is unavailable in this session");
      return;
    }
    void orchestrator.refresh();
    this.editorSlot.showSelector((done) => {
      const tick = every(() => this.ui.requestRender(), 1000);
      const closePane = this.orchestratorPane.openThreads();
      const view = new TasksView(
        {
          maxHeight: () => this.ui.terminal.rows - 4,
          onClose: () => {
            done();
            this.ui.requestRender();
          },
          onError: (message) => this.showError(message),
          onPickModel: (id) => this.showTaskModelSelector(id),
          orchestrator,
          requestRender: () => this.ui.requestRender(),
          state: this.tasksViewState,
        },
        initialId,
      );
      return {
        component: view,
        dispose: () => {
          tick.cancel();
          closePane();
        },
        focus: view,
      };
    });
  }

  private showMemoryView(): void {
    const memory = this.session.memory;
    if (memory === undefined) {
      this.showStatus("Memory is disabled (settings: memory.enabled)");
      return;
    }
    this.editorSlot.showSelector((done) => {
      const view = new MemoryView({
        confirm: (message) => this.extensionDialogs.confirm("Forget memory", message),
        maxHeight: () => this.ui.terminal.rows - 4,
        onClose: () => {
          done();
          this.ui.requestRender();
        },
        onError: (message) => this.showError(message),
        requestRender: () => this.ui.requestRender(),
        service: memory,
      });
      return { component: view, focus: view };
    });
  }

  private showTaskModelSelector(id: string): void {
    const orchestrator = this.session.orchestrator;
    if (orchestrator === undefined) return;
    this.editorSlot.showSelector((done) => {
      const back = () => {
        done();
        this.showTasksView(id);
      };
      const selector = new ModelSelectorComponent(
        this.ui,
        undefined,
        this.session.modelRuntime,
        this.session.scopedModels,
        (model) => {
          orchestrator
            .setModel(id, `${model.provider}/${model.id}`)
            .then(back, (error: unknown) => {
              back();
              this.showError(toErrorMessage(error));
            });
        },
        back,
      );
      return { component: selector, dispose: () => selector.dispose(), focus: selector };
    });
  }

  private showSessionSelector(): void {
    this.editorSlot.showSelector((done) => {
      const selector = new SessionSelectorComponent(
        (onProgress, signal) =>
          SessionManager.list(
            this.sessionManager.getCwd(),
            this.sessionManager.getSessionDir(),
            onProgress,
            signal,
          ),
        (onProgress, signal) =>
          this.sessionManager.usesDefaultSessionDir()
            ? SessionManager.listAll(onProgress, signal)
            : SessionManager.listAll(this.sessionManager.getSessionDir(), onProgress, signal),
        (sessionPath) =>
          Effect.runPromise(
            awaitingWith(function* () {
              done();
              yield* performed(this.handleResumeSession(sessionPath));
            }, this),
          ),
        () => {
          done();
          this.ui.requestRender();
        },
        () => {
          void void this.shutdown();
        },
        () => this.ui.requestRender(),
        {
          keybindings: this.keybindings,
          renameSession: (sessionFilePath: string, nextName: string | undefined) =>
            Effect.runPromise(
              Effect.sync(() => {
                const next = (nextName ?? "").trim();
                if (next === "") return;
                const mgr = SessionManager.open(sessionFilePath);
                mgr.appendSessionInfo(next);
              }),
            ),
          showRenameHint: true,
        },

        this.sessionManager.getSessionFile(),
      );
      return { component: selector, focus: selector };
    });
  }

  private handleResumeSession(
    sessionPath: string,
    options?: Parameters<ExtensionCommandContext["switchSession"]>[1],
  ): Effect.Effect<{ cancelled: boolean }> {
    return awaitingWith(function* () {
      this.clearStatusIndicator();
      try {
        const result = yield* awaited(
          this.runtimeHost.switchSession(sessionPath, {
            projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
            withSession: options?.withSession,
          }),
        );
        if (result.cancelled) {
          return result;
        }
        this.showStatus("Resumed session");
        return result;
      } catch (error: unknown) {
        if (error instanceof MissingSessionCwdError) {
          const selectedCwd = yield* awaited(this.promptForMissingSessionCwd(error));
          if (selectedCwd === undefined || selectedCwd === "") {
            this.showStatus("Resume cancelled");
            return { cancelled: true };
          }
          const result = yield* awaited(
            this.runtimeHost.switchSession(sessionPath, {
              cwdOverride: selectedCwd,
              projectTrustContextFactory: (cwd) => this.createProjectTrustContext(cwd),
              withSession: options?.withSession,
            }),
          );
          if (result.cancelled) {
            return result;
          }
          this.showStatus("Resumed session in current cwd");
          return result;
        }
        return yield* awaited(this.handleFatalRuntimeError("Failed to resume session", error));
      }
    }, this);
  }

  private handleReloadCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.session.isStreaming) {
          this.showWarning("Wait for the current response to finish before reloading.");
          return;
        }
        if (this.session.isCompacting) {
          this.showWarning("Wait for compaction to finish before reloading.");
          return;
        }

        let { chatRestoredBeforeSessionStart, reloadBoxDismissed, previousEditor } =
          yield* performed(InteractiveMode.handleReloadCommandChatRestoredBeforeSessionStart(this));
        const restoreChatBeforeSessionStart = () => {
          if (chatRestoredBeforeSessionStart) {
            return;
          }
          this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
          this.outputPad = this.settingsManager.getOutputPad();
          this.rebuildChatFromMessages();
          chatRestoredBeforeSessionStart = true;
        };

        try {
          yield* awaited(
            this.session.reload({ beforeSessionStart: restoreChatBeforeSessionStart }),
          );
          restoreChatBeforeSessionStart();
          this.keybindings.reload();
          const activeHeader = this.customHeader ?? this.builtInHeader;
          if (isExpandable(activeHeader)) {
            activeHeader.setExpanded(this.toolOutputExpanded);
          }
          setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
          this.applyRuntimeSettings();
          this.themeController.applyFromSettings();
          this.setupAutocompleteProvider();
          const runner = this.session.extensionRunner;
          this.setupExtensionShortcuts(runner);
          this.showLoadedResources({
            force: false,
            showDiagnosticsWhenQuiet: true,
          });
          const savedImplicitProjectTrust = this.maybeSaveImplicitProjectTrustAfterReload();
          const modelsJsonError = this.session.modelRuntime.getError();
          if (modelsJsonError !== undefined && modelsJsonError !== "") {
            this.showError(`models.json error: ${modelsJsonError}`);
          }
          this.showStatus(
            savedImplicitProjectTrust
              ? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
              : "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
          );
          this.editorSlot.show(this.editor);
          reloadBoxDismissed = true;
        } catch (error) {
          if (!reloadBoxDismissed) {
            this.editorSlot.show(previousEditor);
          }
          this.showError(`Reload failed: ${toErrorMessage(error)}`);
        }
      }, this),
    );
  }

  private static handleReloadCommandChatRestoredBeforeSessionStart(
    self: InteractiveMode,
  ): Effect.Effect<{
    chatRestoredBeforeSessionStart: boolean;
    reloadBoxDismissed: boolean;
    previousEditor: ActiveEditor;
  }> {
    return awaiting(function* () {
      self.resetExtensionUI();

      const reloadBox = new Container();
      const borderColor = (s: string) => theme.fg("border", s);
      reloadBox.addChild(new DynamicBorder(borderColor));
      reloadBox.addChild(new Spacer(1));
      reloadBox.addChild(
        new ThemedText(
          () =>
            theme.fg(
              "muted",
              "Reloading keybindings, extensions, skills, prompts, themes, and context files...",
            ),
          1,
          0,
        ),
      );
      reloadBox.addChild(new Spacer(1));
      reloadBox.addChild(new DynamicBorder(borderColor));

      const previousEditor = self.editor;
      self.editorSlot.show(reloadBox);
      self.ui.requestRender(true);
      yield* performed(
        Effect.callback<void>((resume) => {
          process.nextTick(() => resume(Effect.void));
        }),
      );

      let chatRestoredBeforeSessionStart = false;
      let reloadBoxDismissed = false;
      return { chatRestoredBeforeSessionStart, previousEditor, reloadBoxDismissed };
    });
  }

  private handleExportCommand(text: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const outputPath = this.getPathCommandArgument(text, "/export");

      try {
        const filePath =
          outputPath?.endsWith(".jsonl") === true
            ? this.session.exportToJsonl(outputPath)
            : yield* awaited(
                this.session.exportToHtml(outputPath, {
                  themeName: theme.name,
                }),
              );
        this.showStatus(`Session exported to: ${filePath}`);
      } catch (error: unknown) {
        this.showError(
          `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }, this);
  }

  private getPathCommandArgument(text: string, command: "/export" | "/import"): string | undefined {
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

  private handleImportCommand(text: string): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const inputPath = this.getPathCommandArgument(text, "/import");
        if (inputPath === undefined || inputPath === "") {
          this.showError("Usage: /import <path.jsonl>");
          return;
        }

        const confirmed = yield* awaited(
          this.extensionDialogs.confirm(
            "Import session",
            `Replace current session with ${inputPath}?`,
          ),
        );
        if (!confirmed) {
          this.showStatus("Import cancelled");
          return;
        }

        try {
          this.clearStatusIndicator();
          const result = yield* awaited(this.runtimeHost.importFromJsonl(inputPath));
          if (result.cancelled) {
            this.showStatus("Import cancelled");
            return;
          }
          this.showStatus(`Session imported from: ${inputPath}`);
        } catch (error: unknown) {
          if (error instanceof MissingSessionCwdError) {
            const selectedCwd = yield* awaited(this.promptForMissingSessionCwd(error));
            if (selectedCwd === undefined || selectedCwd === "") {
              this.showStatus("Import cancelled");
              return;
            }
            const result = yield* awaited(this.runtimeHost.importFromJsonl(inputPath, selectedCwd));
            if (result.cancelled) {
              this.showStatus("Import cancelled");
              return;
            }
            this.showStatus(`Session imported from: ${inputPath}`);
            return;
          }
          if (error instanceof SessionImportFileNotFoundError) {
            this.showError(`Failed to import session: ${error.message}`);
            return;
          }
          yield* awaited(this.handleFatalRuntimeError("Failed to import session", error));
        }
      }, this),
    );
  }

  private handleShareCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        shareSession({
          editorSlot: this.editorSlot,
          session: this.session,
          showError: (message) => this.showError(message),
          showStatus: (message) => this.showStatus(message),
          ui: this.ui,
        }),
      );
    }, this);
  }

  private handleBugCommand(hint: string | undefined): Effect.Effect<void> {
    return awaitingWith(function* () {
      yield* awaited(
        reportBug(
          {
            editorSlot: this.editorSlot,
            keybindings: this.keybindings,
            session: this.session,
            showError: (message) => this.showError(message),
            showStatus: (message) => this.showStatus(message),
            ui: this.ui,
          },
          hint,
        ),
      );
    }, this);
  }

  private handleCopyCommand(
    options: { flashConfirmation?: boolean; preferSelection?: boolean } = {},
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (
          options.preferSelection === true &&
          this.ui instanceof TuiAltScreen &&
          !this.ui.getCopyOnSelect() &&
          this.ui.hasActiveSelection()
        ) {
          yield* awaited(this.ui.copyActiveSelectionToClipboard());
          return;
        }

        const text = this.session.getLastAssistantText();
        if (text === undefined || text === "") {
          this.showError("No agent messages to copy yet.");
          return;
        }

        try {
          yield* awaited(copyToClipboard(text));
          if (options.flashConfirmation === true && this.ui instanceof TuiAltScreen) {
            this.ui.flash("Copied!");
          } else {
            this.showStatus("Copied last agent message to clipboard");
          }
        } catch (error) {
          this.showError(toErrorMessage(error));
        }
      }, this),
    );
  }

  private handleNameCommand(text: string): void {
    const name = text.replace(/^\/rename\s*/u, "").trim();
    if (name === "") {
      const currentName = this.sessionManager.getSessionName();
      if (currentName !== undefined && currentName !== "") {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new ThemedText(() => theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.showWarning("Usage: /rename <name>");
      }
      this.ui.requestRender();
      return;
    }

    this.session.setSessionName(name);
    const sessionName = this.sessionManager.getSessionName();
    if (sessionName !== name) {
      this.showWarning(
        `Session name was normalized from ${JSON.stringify(name)} to ${JSON.stringify(sessionName)}`,
      );
    }
    this.chatContainer.addChild(new Spacer(1));
    const displayName = sessionName ?? name;
    this.chatContainer.addChild(
      new ThemedText(() => theme.fg("dim", `Session name set: ${displayName}`), 1, 0),
    );
    this.ui.requestRender();
  }

  private handleSessionCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = this.sessionManager.getEntries();
        const model = this.session.model;
        const contextBreakdown = yield* awaited(this.session.getContextBreakdown());
        const telemetry = this.runtimeHost.telemetry;
        const info: SessionInfo = {
          cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
          cacheWarmingStatus: this.session.cacheWarmingStatus,
          cacheWaste: computeCacheWaste(entries, this.session.modelRuntime),
          contextBreakdown,
          contextWindow: this.session.getContextUsage()?.contextWindow ?? model?.contextWindow,
          selectedModelKey: `${model?.provider}/${model?.id}`,
          sessionName: this.sessionManager.getSessionName(),
          stats: this.session.getSessionStats(),
          telemetry: telemetry === undefined ? undefined : describeTelemetry(telemetry.status()),
          usageBreakdown: getUsageCostBreakdown(entries),
        };
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new ThemedText(() => formatSessionInfo(info), 1, 0));
        this.ui.requestRender();
      }, this),
    );
  }

  private handleChangelogCommand(): void {
    const changelogPath = getChangelogPath();
    const allEntries = parseChangelog(changelogPath);

    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => normalizeChangelogLinks(e.content, e))
            .join("\n\n")
        : "No changelog entries found.";

    this.addMarkdownPanel("What's New", changelogMarkdown);
  }

  private addMarkdownPanel(title: string, markdown: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(new ThemedText(() => theme.bold(theme.fg("accent", title)), 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Markdown(markdown, 1, 1, this.getMarkdownThemeWithSettings()));
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  private handleHelpCommand(): void {
    const commands = [
      ...this.session.extensionRunner
        .getRegisteredCommands()
        .filter((command) => !isBuiltinSlashCommandName(command.name))
        .map((command) => ({ description: command.description, name: command.invocationName })),
      ...this.session.promptTemplates,
    ];
    const skills = this.settingsManager.getEnableSkillCommands()
      ? this.session.resourceLoader.getSkills().skills
      : [];
    this.addMarkdownPanel("Commands", formatHelpMarkdown(withSkillCommands(commands, skills)));
  }

  private isSkillCommand(text: string): boolean {
    if (!this.settingsManager.getEnableSkillCommands()) return false;
    const name = slashCommandName(text);
    return this.session.resourceLoader.getSkills().skills.some((skill) => skill.name === name);
  }

  private handleHotkeysCommand(): void {
    const shortcuts = this.session.extensionRunner.getShortcuts(
      this.keybindings.getEffectiveConfig(),
    );
    this.addMarkdownPanel("Keyboard Shortcuts", formatHotkeysMarkdown(shortcuts));
  }

  private handleClearCommand(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.clearStatusIndicator();
      try {
        const result = yield* awaited(this.runtimeHost.newSession());
        if (result.cancelled) {
          return;
        }
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new ThemedText(() => theme.fg("accent", "✓ New session started"), 1, 1),
        );
        this.ui.requestRender();
      } catch (error: unknown) {
        yield* awaited(this.handleFatalRuntimeError("Failed to create session", error));
      }
    }, this);
  }

  private handleDebugCommand(): void {
    const width = this.ui.terminal.columns;
    const height = this.ui.terminal.rows;
    const allLines = this.ui.render(width);

    const debugLogPath = getDebugLogPath();
    const debugData = [
      `Debug output at ${nowIso()}`,
      `Terminal: ${width}x${height}`,
      `Total lines: ${allLines.length}`,
      "",
      "=== All rendered lines with visible widths ===",
      ...allLines.map((line, idx) => {
        const vw = visibleWidth(line);
        const escaped = JSON.stringify(line);
        return `[${idx}] (w=${vw}) ${escaped}`;
      }),
      "",
      "=== Agent messages (JSONL) ===",
      ...this.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    fs.mkdirSync(dirname(debugLogPath), { recursive: true });
    fs.writeFileSync(debugLogPath, debugData);

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new ThemedText(
        () => `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.ui.requestRender();
  }

  private handleArminSaysHi(): void {
    if (playArmin3d(this.renderer)) return;
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new ArminComponent(this.ui));
    this.ui.requestRender();
  }

  private handleDementedDelves(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new EarendilAnnouncementComponent());
    this.ui.requestRender();
  }

  private handleBashCommand(command: string, excludeFromContext = false): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const extensionRunner = this.session.extensionRunner;

        let eventResult: UserBashEventResult | undefined;
        try {
          eventResult = yield* awaited(
            extensionRunner.emitUserBash({
              command,
              cwd: this.sessionManager.getCwd(),
              excludeFromContext,
              type: "user_bash",
            }),
          );
        } catch {
          return;
        }

        if (eventResult?.result !== undefined) {
          const result = eventResult.result;

          this.bashComponent = new BashExecutionComponent(
            command,
            this.ui,
            excludeFromContext,
            this.outputPad,
          );
          if (this.session.isStreaming) {
            this.pendingMessagesContainer.addChild(this.bashComponent);
            this.pendingBashComponents.push(this.bashComponent);
          } else {
            this.chatContainer.addChild(this.bashComponent);
          }

          if (result.output !== "") {
            this.bashComponent.appendOutput(result.output);
          }
          this.bashComponent.setComplete(
            result.exitCode,
            result.cancelled,
            result.truncated
              ? ({ content: result.output, truncated: true } as TruncationResult)
              : undefined,
            result.fullOutputPath,
          );

          this.session.recordBashResult(command, result, { excludeFromContext });
          this.bashComponent = undefined;
          this.ui.requestRender();
          return;
        }

        const isDeferred = this.session.isStreaming;
        this.bashComponent = new BashExecutionComponent(
          command,
          this.ui,
          excludeFromContext,
          this.outputPad,
        );

        if (isDeferred) {
          this.pendingMessagesContainer.addChild(this.bashComponent);
          this.pendingBashComponents.push(this.bashComponent);
        } else {
          this.chatContainer.addChild(this.bashComponent);
        }
        this.ui.requestRender();

        try {
          const result = yield* awaited(
            this.session.executeBash(
              command,
              (chunk) => {
                if (this.bashComponent !== undefined) {
                  this.bashComponent.appendOutput(chunk);
                  this.ui.requestRender();
                }
              },
              { excludeFromContext, operations: eventResult?.operations },
            ),
          );

          if (this.bashComponent !== undefined) {
            this.bashComponent.setComplete(
              result.exitCode,
              result.cancelled,
              result.truncated
                ? ({ content: result.output, truncated: true } as TruncationResult)
                : undefined,
              result.fullOutputPath,
            );
          }
        } catch (error) {
          if (this.bashComponent !== undefined) {
            this.bashComponent.setComplete(undefined, false);
          }
          this.showError(
            `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }

        this.bashComponent = undefined;
        this.ui.requestRender();
      }, this),
    );
  }

  private handleCompactCommand(customInstructions?: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.clearStatusIndicator();

      try {
        yield* awaited(this.session.compact(customInstructions));
      } catch {}
    }, this);
  }

  stop(fullscreenExitOutput = this.settingsManager.getFullscreenExitOutput()): void {
    this.editorSlot.disposeActiveSelector();
    if (this.settingsManager.getShowTerminalProgress()) {
      this.ui.terminal.setProgress(false);
    }
    this.clearStatusIndicator();
    this.themeController.disableAutoSync();
    this.clearExtensionTerminalInputListeners();
    this.footer.dispose();
    this.footerDataProvider.dispose();
    if (this.goalTicker !== undefined) this.goalTicker.cancel();
    this.goalTicker = undefined;
    if (this.unsubscribe !== undefined) {
      this.unsubscribe();
    }
    if (this.isInitialized) {
      this.stopInteractiveTui(fullscreenExitOutput);
      this.isInitialized = false;
    }
    this.unregisterSignalHandlers();
  }
}
