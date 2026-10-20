import tui from "@msa/tui";

import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import SessionSelectorComponentLayer1 from "./session-selector-layer-1.ts";

const { Container, Spacer, Text } = tui;
const { theme } = themeModule;
const { keyText } = keybindingHints;

export default abstract class SessionSelectorComponentLayer2 extends SessionSelectorComponentLayer1 {
  enterRenameMode(sessionPath: string, currentName: string | undefined): void {
    this.mode = "rename";
    this.renameTargetPath = sessionPath;
    this.renameInput.setValue(currentName ?? "");
    this.renameInput.focused = true;

    const panel = new Container();
    panel.addChild(new Text(theme.bold("Rename Session"), 1, 0));
    panel.addChild(new Spacer(1));
    panel.addChild(this.renameInput);
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

    this.buildBaseLayout(panel, { showHeader: false });
    this.requestRender();
  }
}
