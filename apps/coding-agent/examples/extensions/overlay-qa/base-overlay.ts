import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";

const { truncateToWidth, visibleWidth } = tui;

export default abstract class BaseOverlay {
  protected theme: codingAgentTypes.Theme;

  constructor(theme: codingAgentTypes.Theme) {
    this.theme = theme;
  }

  protected box(lines: string[], width: number, title?: string): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const result: string[] = [];

    const titleStr =
      title !== undefined && title.length > 0 ? truncateToWidth(` ${title} `, innerW) : "";
    const titleW = visibleWidth(titleStr);
    const topLine = "─".repeat(Math.floor((innerW - titleW) / 2));
    const topLine2 = "─".repeat(Math.max(0, innerW - titleW - topLine.length));
    result.push(
      th.fg("border", `╭${topLine}`) + th.fg("accent", titleStr) + th.fg("border", `${topLine2}╮`),
    );

    for (const line of lines) {
      result.push(
        th.fg("border", "│") + truncateToWidth(line, innerW, "...", true) + th.fg("border", "│"),
      );
    }

    result.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
    return result;
  }

  invalidate(): void {}
  dispose(): void {}
}
