import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import clipboard from "../../../utils/clipboard.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";

const { theme } = themeModule;
const { keyHint } = keybindingHints;
const { awaited, awaitingWith } = awaitingModule;
const { copyToClipboard } = clipboard;
const { toErrorMessage } = errors;

const { Text, hyperlink } = tuiModule;

export default class AuthUrlComponent extends tuiModule.Container {
  readonly url: string;
  private readonly tui: tuiTypes.TUI;
  private readonly hint: tuiTypes.Text;

  constructor(tui: tuiTypes.TUI, url: string) {
    super();
    this.tui = tui;
    this.url = url;
    this.addChild(new Text(theme.fg("accent", hyperlink(url, url)), 1, 0));
    this.hint = new Text("", 1, 0);
    this.addChild(this.hint);
    this.setHint(keyHint("app.message.copy", "to copy"));
  }

  private setHint(suffix: string): void {
    const clickHint = process.platform === "darwin" ? "Cmd+click to open" : "Ctrl+click to open";
    this.hint.setText(
      `${theme.fg("dim", hyperlink(clickHint, this.url))} ${theme.fg("dim", "•")} ${suffix}`,
    );
    this.tui.requestRender();
  }

  copy(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          yield* awaited(copyToClipboard(this.url));
          this.setHint(theme.fg("success", "Copied URL to clipboard"));
        } catch (error) {
          this.setHint(theme.fg("error", toErrorMessage(error)));
        }
      }, this),
    );
  }
}
