import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../core/awaiting.ts";
import errorsModule from "../../utils/errors.ts";
import DynamicBorder from "./components/dynamic-border.ts";
import ThemedText from "./components/themed-text.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer41 from "./interactive-mode-layer-41.ts";
import themeModule from "./theme/theme.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { Container, Spacer } = tuiModule;
const { theme } = themeModule;
const { syncCommand } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer42 extends InteractiveModeLayer41 {
  protected builtinViewCommands(): Record<string, interactiveModeInternalTypes.BuiltinCommand> {
    const after = (run: () => void) => ({ args: false, clearFirst: false, run: syncCommand(run) });
    return {
      "/arminsayshi": after(() => this.handleArminSaysHi()),
      "/config": after(() => this.showSettingsSelector()),
      "/debug": after(() => this.handleDebugCommand()),
      "/dementedelves": after(() => this.handleDementedDelves()),
      "/fork": after(() => this.showUserMessageSelector()),
      "/help": after(() => this.handleHelpCommand()),
      "/keybindings": after(() => this.handleHotkeysCommand()),
      "/logout": after(() => void this.loginFlow.logout()),
      "/memory": after(() => this.showMemoryView()),
      "/release-notes": after(() => this.handleChangelogCommand()),
      "/resume": after(() => this.showSessionSelector()),
      "/rewind": after(() => this.showTreeSelector()),
      "/tasks": after(() => this.showTasksView()),
      "/threads": after(() => this.showTasksView()),
      "/trust": after(() => this.showTrustSelector()),
    };
  }

  protected handleReloadCommand(): Promise<void> {
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
        const reload = yield* performed(this.handleReloadCommandChatRestoredBeforeSessionStart());
        let { chatRestoredBeforeSessionStart } = reload;
        const restoreChatBeforeSessionStart = () => {
          if (chatRestoredBeforeSessionStart) return;
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
          this.applyReloadedResources();
          this.editorSlot.show(this.editor);
        } catch (error) {
          if (!reload.reloadBoxDismissed) this.editorSlot.show(reload.previousEditor);
          this.showError(`Reload failed: ${toErrorMessage(error)}`);
        }
      }, this),
    );
  }

  protected handleReloadCommandChatRestoredBeforeSessionStart(): Effect.Effect<{
    chatRestoredBeforeSessionStart: boolean;
    reloadBoxDismissed: boolean;
    previousEditor: interactiveModeInternalTypes.ActiveEditor;
  }> {
    return awaitingWith(function* () {
      this.resetExtensionUI();

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

      const previousEditor = this.editor;
      this.editorSlot.show(reloadBox);
      this.ui.requestRender(true);
      yield* performed(
        Effect.callback<void>((resume) => {
          process.nextTick(() => resume(Effect.void));
        }),
      );

      let chatRestoredBeforeSessionStart = false;
      let reloadBoxDismissed = false;
      return { chatRestoredBeforeSessionStart, previousEditor, reloadBoxDismissed };
    }, this);
  }
}
