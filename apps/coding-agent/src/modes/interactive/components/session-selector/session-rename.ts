import tui from "@msa/tui";
import { Effect } from "effect";

import awaitingModule from "../../../../core/awaiting.ts";
import themeModule from "../../theme/theme.ts";
import keybindingHints from "../keybinding-hints.ts";
import type SessionSelectorComponent from "../session-selector.ts";

const { Spacer, Container, Text } = tui;
const { theme } = themeModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { keyText } = keybindingHints;

export default class SessionRename {
  private readonly selector: SessionSelectorComponent;

  constructor(selector: SessionSelectorComponent) {
    this.selector = selector;
  }

  exitRenameMode(): void {
    this.selector.mode = "list";
    this.selector.renameTargetPath = null;

    this.selector.wiring.buildBaseLayout(this.selector.sessionList);

    this.selector.requestRender();
  }

  confirmRename(value: string): Effect.Effect<void> {
    return awaitingWith(function* () {
      const next = value.trim();
      if (next === "") return;
      const target = this.renameTargetPath;
      if (target === null || target === "") {
        this.rename.exitRenameMode();
        return;
      }

      const renameSession = this.renameSession;
      if (renameSession === undefined) {
        this.rename.exitRenameMode();
        return;
      }

      try {
        yield* awaited(renameSession(target, next));
        yield* performed(this.loading.refreshSessionsAfterMutation());
      } finally {
        this.rename.exitRenameMode();
      }
    }, this.selector);
  }

  enterRenameMode(sessionPath: string, currentName: string | undefined): void {
    this.selector.mode = "rename";
    this.selector.renameTargetPath = sessionPath;
    this.selector.renameInput.setValue(currentName ?? "");
    this.selector.renameInput.focused = true;

    const panel = new Container();
    panel.addChild(new Text(theme.bold("Rename Session"), 1, 0));
    panel.addChild(new Spacer(1));
    panel.addChild(this.selector.renameInput);
    panel.addChild(new Spacer(1));
    panel.addChild(
      new Text(
        theme.fg(
          "muted",
          `${keyText("tui.select.confirm")} to save · ${keyText("tui.select.cancel")} to cancel`,
        ),
        1,
        0,
      ),
    );

    this.selector.wiring.buildBaseLayout(panel, { showHeader: false });
    this.selector.requestRender();
  }
}
