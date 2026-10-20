import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import type keybindingsTypes from "../../core/keybindings.types.ts";
import MissingSessionCwdError from "../../core/missing-session-cwd-error.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer37 from "./interactive-mode-layer-37.ts";
import themeModule from "./theme/theme.ts";
import type themeTypes from "./theme/theme.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { getAvailableThemesWithPaths, getThemeByName, theme } = themeModule;

export default abstract class InteractiveModeLayer38 extends InteractiveModeLayer37 {
  protected setupExtensionShortcutsCreateContext(
    extensionRunner: extensionsTypes.ExtensionRunner,
  ): () => extensionsTypes.ExtensionContext {
    const createContext = (): extensionsTypes.ExtensionContext => ({
      abort: () => {
        this.restoreQueuedMessagesToEditor({ abort: true });
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
            }, this),
          ))();
      },
      cwd: this.sessionManager.getCwd(),
      getContextUsage: () => this.session.getContextUsage(),
      getSystemPrompt: () => this.session.systemPrompt,
      hasPendingMessages: () => this.session.pendingMessageCount > 0,
      hasUI: true,
      isIdle: () => this.session.isIdle,
      isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
      mode: "tui",
      model: this.session.model,
      modelRegistry: extensionRunner.getModelRegistry(),
      scopedModels: this.session.scopedModels,
      sessionManager: this.sessionManager,
      shutdown: () => {
        this.shutdownRequested = true;
      },
      signal: this.session.agent.signal,
      thinkingLevel: this.session.thinkingLevel,
      ui: this.createExtensionUIContext(),
    });
    return createContext;
  }

  protected createProjectTrustContext(cwd: string): extensionsTypes.ProjectTrustContext {
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

  protected createExtensionUIContext(): extensionsTypes.ExtensionUIContext {
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
      setTheme: (themeOrName) => this.setThemeFromExtension(themeOrName),
      setTitle: (title) => this.ui.terminal.setTitle(title),
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
      setWidget: (key, content, options) => this.extensionWidgets.set(key, content, options),
      setWorkingIndicator: (options) => this.setWorkingIndicator(options),
      setWorkingMessage: (message) => this.setWorkingMessageFromExtension(message),
      setWorkingVisible: (visible) => this.setWorkingVisible(visible),
      get theme() {
        return theme;
      },
    };
  }

  protected createExtensionCustom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: themeTypes.Theme,
      keybindings: keybindingsTypes.KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | interactiveModeInternalTypes.CustomComponent
      | Promise<interactiveModeInternalTypes.CustomComponent>,
    close: (result: T) => void,
    mount: (created: interactiveModeInternalTypes.CustomComponent) => void,
    abandon: (error: unknown) => void,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        mount(yield* awaited(factory(this.ui, theme, this.keybindings, close)));
      } catch (error: unknown) {
        abandon(error);
      }
    }, this);
  }

  protected showExtensionCustom<T>(
    factory: (
      tui: tuiTypes.TUI,
      theme: themeTypes.Theme,
      keybindings: keybindingsTypes.KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | interactiveModeInternalTypes.CustomComponent
      | Promise<interactiveModeInternalTypes.CustomComponent>,
    options?: interactiveModeInternalTypes.ExtensionCustomOptions,
  ): Promise<T> {
    return Effect.runPromise(
      Effect.callback<T>((resume) => {
        const savedText = this.editor.getText();
        const isOverlay = options?.overlay ?? false;
        const restoreEditor = () => {
          this.editor.setText(savedText);
          this.editorSlot.restoreEditor();
        };
        let component: interactiveModeInternalTypes.CustomComponent | undefined;
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
        const abandon = (error: unknown) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          resume(Effect.die(error));
        };
        const mount = (created: interactiveModeInternalTypes.CustomComponent) => {
          if (closed) return;
          component = created;
          this.mountExtensionCustom(created, options);
        };
        Effect.runFork(this.createExtensionCustom(factory, close, mount, abandon));
      }),
    );
  }

  protected handleResumeSession(
    sessionPath: string,
    options?: Parameters<extensionsTypes.ExtensionCommandContext["switchSession"]>[1],
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
}
