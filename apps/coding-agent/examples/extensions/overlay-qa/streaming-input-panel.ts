import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

const { matchesKey, truncateToWidth, visibleWidth } = tui;

export default class StreamingInputPanel implements tuiTypes.Component {
  handle: tuiTypes.OverlayHandle | null = null;
  private theme: codingAgentTypes.Theme;
  private typed = "";
  readonly label: string;
  private color: "error" | "success" | "accent";
  private onTab: () => void;
  private onClose: () => void;

  constructor(
    theme: codingAgentTypes.Theme,
    label: string,
    color: "error" | "success" | "accent",
    onTab: () => void,
    onClose: () => void,
  ) {
    this.theme = theme;
    this.label = label;
    this.color = color;
    this.onTab = onTab;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "tab")) {
      this.onTab();
    } else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    } else if (matchesKey(data, "backspace")) {
      this.typed = this.typed.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.typed += data;
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const focused = this.handle?.isFocused() ?? false;
    const innerW = Math.max(1, width - 2);
    const border = (c: string) => th.fg(this.color, c);
    const padLine = (s: string) => {
      const w = visibleWidth(s);
      return s + " ".repeat(Math.max(0, innerW - w));
    };

    const inputDisplay = this.typed.length > 0 ? this.typed : th.fg("dim", "(type here)");
    const truncatedInput = truncateToWidth(` > ${inputDisplay}`, innerW, "...", true);

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(border("│") + padLine(` ${th.fg("accent", this.label)}`) + border("│"));
    lines.push(border("│") + padLine("") + border("│"));
    if (focused) {
      lines.push(border("│") + padLine(th.fg("success", " ● FOCUSED")) + border("│"));
      lines.push(border("│") + padLine(th.fg("dim", " (receiving input)")) + border("│"));
    } else {
      lines.push(border("│") + padLine(th.fg("dim", " ○ unfocused")) + border("│"));
      lines.push(border("│") + padLine("") + border("│"));
    }
    lines.push(border("│") + padLine(truncatedInput) + border("│"));
    lines.push(border("│") + padLine("") + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Tab | Esc")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
}
