import tuiModule from "@msa/tui";

import config from "../../../config.ts";
import platformModule from "../../../core/platform/index.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { getDebugLogPath } = config;
const { Spacer, visibleWidth } = tuiModule;
const { nowIso } = platformModule;
const { dirname } = platformModule;
const { makeDirectory, writeFile } = platformModule.files;

export default class DebugCommand {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  handleDebugCommand(): Promise<void> {
    const width = this.mode.ui.terminal.columns;
    const height = this.mode.ui.terminal.rows;
    const allLines = this.mode.ui.render(width);

    const debugLogPath = getDebugLogPath();
    const debugData = [
      `Debug output at ${nowIso()}`,
      `Terminal: ${width}x${height}`,
      `Total lines: ${allLines.length}`,
      "",
      "=== All rendered lines with visible widths ===",
      ...allLines.map((line, idx) => {
        const vw = visibleWidth(line);
        const escaped = JSON.stringify(line);
        return `[${idx}] (w=${vw}) ${escaped}`;
      }),
      "",
      "=== Agent messages (JSONL) ===",
      ...this.mode.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    return makeDirectory({ path: dirname(debugLogPath) })
      .then(() => writeFile({ data: debugData, path: debugLogPath }))
      .then(() => this.showDebugLogWritten(debugLogPath));
  }

  private showDebugLogWritten(debugLogPath: string): void {
    this.mode.layout.chatContainer.addChild(new Spacer(1));
    this.mode.layout.chatContainer.addChild(
      new ThemedText(
        () => `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.mode.ui.requestRender();
  }
}
