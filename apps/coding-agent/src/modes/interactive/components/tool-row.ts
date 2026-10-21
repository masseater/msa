import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import ansi from "../../../utils/ansi.ts";
import themeModule from "../theme/theme.ts";
import type toolExecutionTypes from "./tool-execution.types.ts";

const { theme } = themeModule;
const { stripAnsi } = ansi;
const { truncateToWidth } = tui;

export default class ToolRow implements tuiTypes.Component {
  open = false;
  readonly tool: toolExecutionTypes.ToolExecutionComponent;
  private readonly outputPad: () => number;

  constructor(tool: toolExecutionTypes.ToolExecutionComponent, outputPad: () => number) {
    this.tool = tool;
    this.outputPad = outputPad;
  }

  render(width: number): string[] {
    if (this.open) return this.tool.render(width);
    const callLine = this.tool
      .render(width)
      .map((line) => stripAnsi(line).trim())
      .find((line) => line.length > 0);
    if (callLine === undefined) return [];
    const { done, isError } = this.tool.getCallSummary();
    const color = isError ? "error" : done ? "toolOutput" : "muted";
    const pad = " ".repeat(this.outputPad());
    return [
      truncateToWidth(`${pad}${theme.fg(color, callLine)}${theme.fg("muted", " ›")}`, width, "..."),
    ];
  }

  invalidate(): void {
    this.tool.invalidate();
  }

  handleMouse(event: tuiTypes.TuiMouseEvent): tuiTypes.TuiMouseEventResult | undefined {
    if (this.open) return this.tool.handleMouse(event);
    if (event.type !== "click" || event.button !== "left") return undefined;
    this.open = true;
    return { handled: true };
  }
}
