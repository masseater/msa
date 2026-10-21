import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypes from "../../../core/extensions/index.types.ts";
import errorsModule from "../../../utils/errors.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { setRegisteredThemes } = themeModule;
const { matchesKey } = tuiModule;
const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;

export default class ExtensionSessionBinding {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private forkFromExtension(
    entryId: string,
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["fork"]>[1],
  ) {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const result = yield* awaited(this.mode.runtimeHost.fork(entryId, options));
          if (!result.cancelled) {
            this.mode.editor.setText(result.selectedText ?? "");
            this.mode.display.status.showStatus("Forked to new session");
          }
          return { cancelled: result.cancelled };
        } catch (error: unknown) {
          return yield* awaited(
            this.mode.lifecycle.fatalErrors.handleFatalRuntimeError(
              "Failed to fork session",
              error,
            ),
          );
        }
      }, this),
    );
  }

  private newSessionFromExtension(
    options: Parameters<extensionsTypes.ExtensionCommandContextActions["newSession"]>[0],
  ) {
    this.mode.display.indicator.clearStatusIndicator();
    return Promise.resolve()
      .then(() => this.mode.runtimeHost.newSession(options))
      .catch((error: unknown) =>
        this.mode.lifecycle.fatalErrors.handleFatalRuntimeError("Failed to create session", error),
      );
  }

  private extensionShortcutContextFactory(
    extensionRunner: extensionsTypes.ExtensionRunner,
  ): () => extensionsTypes.ExtensionContext {
    const createContext = (): extensionsTypes.ExtensionContext => ({
      abort: () => {
        this.mode.input.queue.restoreQueuedMessagesToEditor({ abort: true });
      },
      compact: (options) => {
        void (() =>
          Effect.runPromise(
            awaitingWith(function* () {
              try {
                const result = yield* awaited(
                  this.mode.session.compaction.manual.compact(options?.customInstructions),
                );
                options?.onComplete?.(result);
              } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                options?.onError?.(err);
              }
            }, this),
          ))();
      },
      cwd: this.mode.sessionManager.getCwd(),
      getContextUsage: () => this.mode.session.context.stats.getContextUsage(),
      getSystemPrompt: () => this.mode.session.tools.prompt.systemPrompt,
      hasPendingMessages: () => this.mode.session.run.queue.pendingMessageCount > 0,
      hasUI: true,
      isIdle: () => this.mode.session.isIdle,
      isProjectTrusted: () => this.mode.settingsManager.isProjectTrusted(),
      mode: "tui",
      model: this.mode.session.model,
      modelRegistry: extensionRunner.getModelRegistry(),
      scopedModels: this.mode.session.models.selection.scopedModels,
      sessionManager: this.mode.sessionManager,
      shutdown: () => {
        this.mode.lifecycle.shutdown.shutdownRequested = true;
      },
      signal: this.mode.session.agent.signal,
      thinkingLevel: this.mode.session.thinkingLevel,
      ui: this.mode.extensions.ui.createExtensionUIContext(),
    });
    return createContext;
  }

  private applySessionResources(): void {
    setRegisteredThemes(this.mode.session.resourceLoader.getThemes().themes);
    this.mode.input.autocomplete.setupAutocompleteProvider();

    const extensionRunner = this.mode.session.extensions.binding.extensionRunner;
    this.setupExtensionShortcuts(extensionRunner);
    this.mode.display.resources.showLoadedResources({
      force: false,
      showDiagnosticsWhenQuiet: true,
    });
    this.mode.display.notices.startup.showStartupNoticesIfNeeded();
  }

  setupExtensionShortcuts(extensionRunner: extensionsTypes.ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(this.mode.keybindings.getEffectiveConfig());
    if (shortcuts.size === 0) return;

    const createContext = this.extensionShortcutContextFactory(extensionRunner);

    this.mode.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        if (matchesKey(data, shortcutStr as tuiTypes.KeyId)) {
          Promise.resolve(shortcut.handler(createContext())).catch((err) => {
            this.mode.display.status.showError(`Shortcut handler error: ${toErrorMessage(err)}`);
          });
          return true;
        }
      }
      return false;
    };
  }

  private extensionCommandContextActions(): extensionsTypes.ExtensionCommandContextActions {
    return {
      fork: (entryId, options) => this.forkFromExtension(entryId, options),
      navigateTree: (targetId, options) =>
        this.mode.selectors.tree.navigateTreeFromExtension(targetId, options),
      newSession: (options) => this.newSessionFromExtension(options),
      reload: () => this.mode.commands.reload.handleReloadCommand(),
      switchSession: (sessionPath, options) =>
        Effect.runPromise(this.mode.selectors.sessions.handleResumeSession(sessionPath, options)),
      waitForIdle: () => this.mode.session.run.lifecycle.waitForIdle(),
    };
  }

  private bindCurrentSessionExtensions(): Promise<void> {
    return this.mode.session.extensions.binding
      .bindExtensions({
        abortHandler: () => {
          this.mode.input.queue.restoreQueuedMessagesToEditor({ abort: true });
        },
        commandContextActions: this.extensionCommandContextActions(),
        mode: "tui",
        onError: (error) => {
          this.mode.display.status.showExtensionError(
            error.extensionPath,
            error.error,
            error.stack,
          );
        },
        shutdownHandler: () => {
          this.mode.lifecycle.shutdown.shutdownRequested = true;
          if (this.mode.session.isIdle) void this.mode.lifecycle.shutdown.shutdown();
        },
        uiContext: this.mode.extensions.ui.createExtensionUIContext(),
      })
      .then(() => this.applySessionResources());
  }

  rebindCurrentSession(options: { renderBeforeBind?: boolean } = {}): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const session = this.mode.session;

        this.mode.lifecycle.events.unsubscribe?.();
        this.mode.lifecycle.events.unsubscribe = undefined;
        this.mode.layout.programStatus.reset();
        this.mode.lifecycle.screen.applyRuntimeSettings();

        if (options.renderBeforeBind === true) {
          this.mode.view.history.renderCurrentSessionState();
          this.mode.lifecycle.events.subscribeToAgent();
        }

        yield* awaited(this.bindCurrentSessionExtensions());

        if (this.mode.session !== session) {
          return;
        }

        if (options.renderBeforeBind !== true) {
          this.mode.lifecycle.events.subscribeToAgent();
        }

        this.mode.models.selector.updateAvailableProviderCount();
        this.mode.input.keys.updateEditorBorderColor();
        this.mode.lifecycle.events.updateTerminalTitle();
      }, this),
    );
  }

  attachToRuntimeHost(): void {
    const { mode } = this;
    mode.runtimeHost.setBeforeSessionInvalidate(() => {
      mode.extensions.chrome.resetExtensionUI();
    });
    mode.runtimeHost.setRebindSession(() =>
      this.rebindCurrentSession({ renderBeforeBind: true }).then(() =>
        mode.display.theme.themeController.applyFromSettings(),
      ),
    );
  }
}
