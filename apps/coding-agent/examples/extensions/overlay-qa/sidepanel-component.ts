import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import BaseOverlay from "./base-overlay.ts";
const { matchesKey, truncateToWidth } = tuiModule;

export default class SidepanelComponent extends BaseOverlay {
  private tui: tuiTypes.TUI;
  private items = ["Dashboard", "Messages", "Settings", "Help", "About"];
  private selectedIndex = 0;
  private done: () => void;

  constructor(tui: tuiTypes.TUI, theme: codingAgentTypes.Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
    } else if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "return")) {
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const border = (c: string) => th.fg("border", c);
    const lines: string[] = [];

    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(border("│") + padLine(th.fg("accent", " Responsive Sidepanel")) + border("│"));
    lines.push(border("├") + border("─".repeat(innerW)) + border("┤"));

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? th.fg("accent", "→ ") : "  ";
      const text = isSelected ? th.fg("accent", item) : item;
      lines.push(border("│") + padLine(`${prefix}${text}`) + border("│"));
    }

    lines.push(border("├") + border("─".repeat(innerW)) + border("┤"));
    lines.push(
      border("│") + padLine(th.fg("warning", " ⚠ Resize terminal < 100 cols")) + border("│"),
    );
    lines.push(border("│") + padLine(th.fg("warning", "   to see panel auto-hide")) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Uses visible: (w) => w >= 100")) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " ↑↓ navigate | Esc close")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }
}
