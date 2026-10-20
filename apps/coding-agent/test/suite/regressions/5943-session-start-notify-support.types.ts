import type tuiTypes from "@msa/tui/index.types";

import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";

declare namespace SessionStartNotifySupportTypes {
  type LoadedResourcesResult<T> = { [K in keyof T]: T[K] } & { diagnostics: [] };

  type LoadedResourcesContext = {
    loadedResourcesContainer: tuiTypes.Container;
    chatContainer: tuiTypes.Container;
    options: { verbose?: boolean };
    settingsManager: { getQuietStartup: () => boolean };
    sessionManager: { getCwd: () => string };
    session: {
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
      extensionRunner: {
        getCommandDiagnostics: () => [];
        getShortcutDiagnostics: () => [];
        getRegisteredCommands: () => [];
      };
    };
    isStartupExpanded: () => boolean;
    getStartupVisibility: () => { header: boolean; details: boolean };
    getBuiltInCommandConflictDiagnostics: (
      extensionRunner: LoadedResourcesContext["session"]["extensionRunner"],
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
      isStreaming: boolean;
      isCompacting: boolean;
      reload: (options?: { beforeSessionStart?: () => void | Promise<void> }) => Promise<void>;
      resourceLoader: { getThemes: () => { themes: [] } };
      extensionRunner: unknown;
      modelRegistry: { getError: () => string | undefined };
    };
    settingsManager: {
      getHttpIdleTimeoutMs: () => number;
      getHideThinkingBlock: () => boolean;
      getOutputPad: () => 0 | 1;
      getEditorPaddingX: () => number;
      getAutocompleteMaxVisible: () => number;
      getShowHardwareCursor: () => boolean;
      getClearOnShrink: () => boolean;
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
    session?: Partial<ReloadCommandContext["session"]>;
    settingsManager?: Partial<ReloadCommandContext["settingsManager"]>;
    keybindings?: Partial<ReloadCommandContext["keybindings"]>;
    editorSlot?: Partial<ReloadCommandContext["editorSlot"]>;
    ui?: Partial<ReloadCommandContext["ui"]>;
    defaultEditor?: Partial<ReloadCommandContext["defaultEditor"]>;
    themeController?: Partial<ReloadCommandContext["themeController"]>;
  };

  type MessageEvent = Extract<AgentSessionEvent, { type: "message_start" | "message_end" }>;
}

export type { SessionStartNotifySupportTypes as default };
