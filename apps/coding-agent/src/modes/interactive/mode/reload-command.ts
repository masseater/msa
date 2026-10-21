import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import ProjectTrustStore from "../../../core/project-trust-store.ts";
import trustManager from "../../../core/trust-manager.ts";
import errorsModule from "../../../utils/errors.ts";
import expandableTextSupport from "../components/expandable-text-support.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { setRegisteredThemes } = themeModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { isExpandable } = expandableTextSupport;
const { hasTrustRequiringProjectResources } = trustManager;

export default class ReloadCommand {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  autoTrustOnReloadCwd!: string | undefined;

  private maybeSaveImplicitProjectTrustAfterReload(): Promise<boolean> {
    const cwd = this.mode.sessionManager.getCwd();
    if (this.autoTrustOnReloadCwd !== cwd || !this.mode.settingsManager.isProjectTrusted()) {
      return Promise.resolve(false);
    }
    return hasTrustRequiringProjectResources(cwd).then((requiresTrust) =>
      requiresTrust ? this.saveImplicitProjectTrust(cwd) : false,
    );
  }

  private saveImplicitProjectTrust(cwd: string): Promise<boolean> {
    const trustStore = new ProjectTrustStore(this.mode.runtimeHost.services.agentDir);
    return trustStore
      .get(cwd)
      .then((decision) => {
        this.autoTrustOnReloadCwd = undefined;
        return decision === null ? trustStore.set(cwd, true).then(() => true) : false;
      })
      .catch((error: unknown) => {
        this.mode.display.status.showWarning(
          `Could not save project trust after reload: ${toErrorMessage(error)}`,
        );
        return false;
      });
  }

  private applyReloadedResources(): Promise<void> {
    this.mode.keybindings.reload();
    const activeHeader = this.mode.layout.customHeader ?? this.mode.layout.builtInHeader;
    if (isExpandable(activeHeader))
      activeHeader.setExpanded(this.mode.display.resources.toolOutputExpanded);
    setRegisteredThemes(this.mode.session.resourceLoader.getThemes().themes);
    this.mode.lifecycle.screen.applyRuntimeSettings();
    this.mode.display.theme.themeController.applyFromSettings();
    this.mode.input.autocomplete.setupAutocompleteProvider();
    this.mode.extensions.binding.setupExtensionShortcuts(
      this.mode.session.extensions.binding.extensionRunner,
    );
    this.mode.display.resources.showLoadedResources({
      force: false,
      showDiagnosticsWhenQuiet: true,
    });
    return Promise.resolve(this.maybeSaveImplicitProjectTrustAfterReload()).then(
      (savedImplicitProjectTrust) => this.reportReload(savedImplicitProjectTrust),
    );
  }

  private reportReload(savedImplicitProjectTrust: boolean): void {
    const modelsJsonError = this.mode.session.models.selection.modelRuntime.getError();
    if (modelsJsonError !== undefined && modelsJsonError !== "")
      this.mode.display.status.showError(`models.json error: ${modelsJsonError}`);
    this.mode.display.status.showStatus(
      savedImplicitProjectTrust
        ? "Reloaded keybindings, extensions, skills, prompts, themes, and context files; saved project trust"
        : "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
    );
  }

  handleReloadCommand(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.mode.session.isStreaming) {
          this.mode.display.status.showWarning(
            "Wait for the current response to finish before reloading.",
          );
          return;
        }
        if (this.mode.session.compaction.manual.isCompacting) {
          this.mode.display.status.showWarning("Wait for compaction to finish before reloading.");
          return;
        }
        const reload = yield* performed(this.mode.commands.reloadBlocker.showReloadBlocker());
        let { chatRestoredBeforeSessionStart } = reload;
        const restoreChatBeforeSessionStart = () => {
          if (chatRestoredBeforeSessionStart) return;
          this.mode.display.thinking.hideThinkingBlock =
            this.mode.settingsManager.display.getHideThinkingBlock();
          this.mode.display.thinking.outputPad = this.mode.settingsManager.terminal.getOutputPad();
          this.mode.view.history.rebuildChatFromMessages();
          chatRestoredBeforeSessionStart = true;
        };
        try {
          yield* awaited(
            this.mode.session.extensions.runtime.reload({
              beforeSessionStart: restoreChatBeforeSessionStart,
            }),
          );
          restoreChatBeforeSessionStart();
          yield* awaited(this.applyReloadedResources());
          this.mode.editorSlot.show(this.mode.editor);
        } catch (error) {
          if (!reload.reloadBoxDismissed) this.mode.editorSlot.show(reload.previousEditor);
          this.mode.display.status.showError(`Reload failed: ${toErrorMessage(error)}`);
        }
      }, this),
    );
  }
}
