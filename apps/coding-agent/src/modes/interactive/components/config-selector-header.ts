import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../../../config.ts";
import themeModule from "../theme/theme.ts";
import type configSelectorTypes from "./config-selector.types.ts";
import keybindingHints from "./keybinding-hints.ts";
const { CONFIG_DIR_NAME } = config;
const { theme } = themeModule;
const { keyHint, rawKeyHint } = keybindingHints;
const { truncateToWidth, visibleWidth } = tui;

export default class ConfigSelectorHeader implements tuiTypes.Component {
  private writeScope: configSelectorTypes.ConfigWriteScope;
  private projectModeAvailable: boolean;

  constructor(writeScope: configSelectorTypes.ConfigWriteScope, projectModeAvailable: boolean) {
    this.writeScope = writeScope;
    this.projectModeAvailable = projectModeAvailable;
  }

  setWriteScope(writeScope: configSelectorTypes.ConfigWriteScope): void {
    this.writeScope = writeScope;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const title = theme.bold(
      this.writeScope === "project" ? "Project Local Resources" : "Global Resources",
    );
    const sep = theme.fg("muted", " · ");
    const switchHint = this.projectModeAvailable
      ? keyHint("tui.input.tab", "switch mode") + sep
      : "";
    const actionHint =
      this.writeScope === "project"
        ? rawKeyHint("space", "cycle inherit/+/-")
        : rawKeyHint("space", "toggle");
    const hint = switchHint + actionHint + sep + rawKeyHint("esc", "close");
    const spacing = Math.max(1, width - visibleWidth(title) - visibleWidth(hint));
    const scopeHint =
      this.writeScope === "project"
        ? theme.fg(
            "muted",
            `${CONFIG_DIR_NAME}/settings.json · inherited global resources are dimmed`,
          )
        : theme.fg("muted", `~/${CONFIG_DIR_NAME}/agent/settings.json`);

    return [
      truncateToWidth(`${title}${" ".repeat(spacing)}${hint}`, width, ""),
      truncateToWidth(scopeHint, width, ""),
    ];
  }
}
