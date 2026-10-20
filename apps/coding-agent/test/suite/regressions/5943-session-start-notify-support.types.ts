import type tuiTypes from "@msa/tui/index.types";

import type agentSessionTypes from "../../../src/core/agent-session.types.ts";

declare namespace SessionStartNotifySupportTypes {
  type LoadedResourcesResult<T> = { [K in keyof T]: T[K] } & { diagnostics: [] };

  type LoadedResourcesContext = {
    loadedResourcesContainer: tuiTypes.Container;
    chatContainer: tuiTypes.Container;
    options: { verbose?: boolean };
    settingsManager: { display: { getQuietStartup: () => boolean } };
    sessionManager: { getCwd: () => string };
    session: {
      extensions: {
        binding: {
          extensionRunner: {
            getCommandDiagnostics: () => [];
            getShortcutDiagnostics: () => [];
            getRegisteredCommands: () => [];
          };
        };
      };
      promptTemplates: [];
      resourceLoader: {
        getAgentsFiles: () => LoadedResourcesResult<{ agentsFiles: Array<{ path: string }> }>;
        getSystemPromptSource: () => { path: string } | undefined;
        getAppendSystemPromptSources: () => Array<{ path: string }>;
        getSkills: () => LoadedResourcesResult<{ skills: [] }>;
        getPrompts: () => LoadedResourcesResult<{ prompts: [] }>;
        getThemes: () => LoadedResourcesResult<{ themes: [] }>;
        getExtensions: () => { extensions: []; errors: [] };
      };
    };
    isStartupExpanded: () => boolean;
    getStartupVisibility: () => { header: boolean; details: boolean };
    getBuiltInCommandConflictDiagnostics: (
      extensionRunner: LoadedResourcesContext["session"]["extensions"]["binding"]["extensionRunner"],
    ) => [];
  };

  type RebindContext = {
    unsubscribe?: () => void;
    applyRuntimeSettings: () => void;
    programStatus: { reset(): void };
    renderCurrentSessionState: () => void;
    bindCurrentSessionExtensions: () => Promise<void>;
    subscribeToAgent: () => void;
    updateAvailableProviderCount: () => Promise<void>;
    updateEditorBorderColor: () => void;
    updateTerminalTitle: () => void;
  };

  type ReloadCommandContext = {
    hideThinkingBlock: boolean;
    session: {
      compaction: { manual: { isCompacting: boolean } };
      extensions: {
        binding: { extensionRunner: unknown };
        runtime: {
          reload: (options?: { beforeSessionStart?: () => void | Promise<void> }) => Promise<void>;
        };
      };
      isStreaming: boolean;
      modelRegistry: { getError: () => string | undefined };
      resourceLoader: { getThemes: () => { themes: [] } };
    };
    settingsManager: {
      display: { getHideThinkingBlock: () => boolean };
      session: { getHttpIdleTimeoutMs: () => number };
      terminal: {
        getAutocompleteMaxVisible: () => number;
        getClearOnShrink: () => boolean;
        getEditorPaddingX: () => number;
        getOutputPad: () => 0 | 1;
        getShowHardwareCursor: () => boolean;
      };
    };
    keybindings: { reload: () => void };
    customHeader?: unknown;
    builtInHeader?: unknown;
    editorSlot: { show: (component: unknown) => void };
    ui: {
      setFocus: (component: unknown) => void;
      requestRender: (force?: boolean) => void;
      setShowHardwareCursor: (enabled: boolean) => void;
      setClearOnShrink: (enabled: boolean) => void;
    };
    editor: unknown;
    defaultEditor: {
      setPaddingX: (padding: number) => void;
      setAutocompleteMaxVisible: (maxVisible: number) => void;
    };
    themeController: { applyFromSettings: () => Promise<void> };
    resetExtensionUI: () => void;
    rebuildChatFromMessages: () => void;
    setupAutocompleteProvider: () => void;
    setupExtensionShortcuts: (runner: unknown) => void;
    showLoadedResources: (options: unknown) => void;
    maybeSaveImplicitProjectTrustAfterReload: () => boolean;
    showStatus: (message: string) => void;
    showWarning: (message: string) => void;
    showError: (message: string) => void;
  };

  type InteractiveModePrototype = {
    showLoadedResources(
      this: LoadedResourcesContext,
      options?: {
        extensions?: Array<{ path: string }>;
        force?: boolean;
        showDiagnosticsWhenQuiet?: boolean;
      },
    ): void;
    rebindCurrentSession(
      this: RebindContext,
      options?: { renderBeforeBind?: boolean },
    ): Promise<void>;
    handleReloadCommand(this: ReloadCommandContext): Promise<void>;
  };

  type ReloadCommandContextOverrides = Omit<
    Partial<ReloadCommandContext>,
    | "session"
    | "settingsManager"
    | "keybindings"
    | "editorSlot"
    | "ui"
    | "defaultEditor"
    | "themeController"
  > & {
    session?: Partial<Omit<ReloadCommandContext["session"], "extensions">> & {
      extensions?: Partial<ReloadCommandContext["session"]["extensions"]>;
    };
    settingsManager?: {
      display?: Partial<ReloadCommandContext["settingsManager"]["display"]>;
    };
    keybindings?: Partial<ReloadCommandContext["keybindings"]>;
    editorSlot?: Partial<ReloadCommandContext["editorSlot"]>;
    ui?: Partial<ReloadCommandContext["ui"]>;
    defaultEditor?: Partial<ReloadCommandContext["defaultEditor"]>;
    themeController?: Partial<ReloadCommandContext["themeController"]>;
  };

  type MessageEvent = Extract<
    agentSessionTypes.AgentSessionEvent,
    { type: "message_start" | "message_end" }
  >;
}

export type { SessionStartNotifySupportTypes as default };
