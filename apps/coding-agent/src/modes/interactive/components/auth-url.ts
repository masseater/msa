import { Container, hyperlink, Text, type TUI } from "@msa/tui";
import { Effect } from "effect";

import { awaited, awaitingWith } from "../../../core/awaiting.ts";
import { copyToClipboard } from "../../../utils/clipboard.ts";
import { toErrorMessage } from "../../../utils/errors.ts";
import { theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";

export class AuthUrlComponent extends Container {
  readonly url: string;
  private readonly tui: TUI;
  private readonly hint: Text;

  constructor(tui: TUI, url: string) {
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
