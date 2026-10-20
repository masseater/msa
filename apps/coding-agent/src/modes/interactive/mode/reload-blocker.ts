import tuiModule from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import DynamicBorder from "../components/dynamic-border.ts";
import ThemedText from "../components/themed-text.ts";
import type interactiveModeInternalTypes from "../interactive-mode-internal.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { Container, Spacer } = tuiModule;
const { awaitingWith, performed } = awaitingModule;

export default class ReloadBlocker {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showReloadBlocker(): Effect.Effect<{
    chatRestoredBeforeSessionStart: boolean;
    reloadBoxDismissed: boolean;
    previousEditor: interactiveModeInternalTypes.ActiveEditor;
  }> {
    return awaitingWith(function* () {
      this.mode.extensions.chrome.resetExtensionUI();

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

      const previousEditor = this.mode.editor;
      this.mode.editorSlot.show(reloadBox);
      this.mode.ui.requestRender(true);
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
