import { Effect } from "effect";

import InteractiveMode from "../../../src/modes/interactive/interactive-mode.ts";
import type SessionStartNotifySupportTypes from "./5943-session-start-notify-support.types.ts";
const interactiveModePrototype =
  InteractiveMode.prototype as unknown as SessionStartNotifySupportTypes.InteractiveModePrototype;

type Overrides = SessionStartNotifySupportTypes.ReloadCommandContextOverrides;
type Context = SessionStartNotifySupportTypes.ReloadCommandContext;

const reloadSession = (overrides: Overrides): Context["session"] => ({
  extensionRunner: {},
  isCompacting: false,
  isStreaming: false,
  modelRegistry: { getError: () => undefined },
  reload: (options) => Promise.resolve(options?.beforeSessionStart?.()).then(() => undefined),
  resourceLoader: { getThemes: () => ({ themes: [] }) },
  ...overrides.session,
});

const reloadSettings = (overrides: Overrides): Context["settingsManager"] => ({
  getAutocompleteMaxVisible: () => 10,
  getClearOnShrink: () => false,
  getEditorPaddingX: () => 1,
  getHideThinkingBlock: () => false,
  getHttpIdleTimeoutMs: () => 0,
  getOutputPad: () => 1,
  getShowHardwareCursor: () => false,
  ...overrides.settingsManager,
});

function createReloadCommandContext(
  overrides: SessionStartNotifySupportTypes.ReloadCommandContextOverrides = {},
): SessionStartNotifySupportTypes.ReloadCommandContext {
  const editor = overrides.editor ?? {};
  const ui = {
    requestRender: () => {},
    setClearOnShrink: () => {},
    setFocus: () => {},
    setShowHardwareCursor: () => {},
    ...overrides.ui,
  };
  return {
    builtInHeader: overrides.builtInHeader,
    customHeader: overrides.customHeader,
    defaultEditor: {
      setAutocompleteMaxVisible: () => {},
      setPaddingX: () => {},
      ...overrides.defaultEditor,
    },
    editor,
    editorSlot: { show: (component) => ui.setFocus(component), ...overrides.editorSlot },
    hideThinkingBlock: overrides.hideThinkingBlock ?? false,
    keybindings: { reload: () => {}, ...overrides.keybindings },
    maybeSaveImplicitProjectTrustAfterReload:
      overrides.maybeSaveImplicitProjectTrustAfterReload ?? (() => false),
    rebuildChatFromMessages: overrides.rebuildChatFromMessages ?? (() => {}),
    resetExtensionUI: overrides.resetExtensionUI ?? (() => {}),
    session: reloadSession(overrides),
    settingsManager: reloadSettings(overrides),
    setupAutocompleteProvider: overrides.setupAutocompleteProvider ?? (() => {}),
    setupExtensionShortcuts: overrides.setupExtensionShortcuts ?? (() => {}),
    showError: overrides.showError ?? (() => {}),
    showLoadedResources: overrides.showLoadedResources ?? (() => {}),
    showStatus: overrides.showStatus ?? (() => {}),
    showWarning: overrides.showWarning ?? (() => {}),
    themeController: {
      applyFromSettings: () => Effect.runPromise(Effect.sync(() => {})),
      ...overrides.themeController,
    },
    ui,
  };
}

function getMessageText(event: SessionStartNotifySupportTypes.MessageEvent): string {
  const message = event.message;
  if (!("content" in message)) {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

const SessionStartNotifySupport = {
  createReloadCommandContext,
  getMessageText,
  interactiveModePrototype,
};

export default SessionStartNotifySupport;
