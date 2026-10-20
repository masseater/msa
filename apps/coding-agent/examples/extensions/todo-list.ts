import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";

import type todoListTypes from "./todo-list.types.ts";

const { matchesKey, truncateToWidth } = tui;

export default class TodoListComponent {
  private todos: todoListTypes.Todo[];
  private theme: codingAgentTypes.Theme;
  private onClose: () => void;
  private cachedWidth?: number | undefined;
  private cachedLines?: string[] | undefined;

  constructor(todos: todoListTypes.Todo[], theme: codingAgentTypes.Theme, onClose: () => void) {
    this.todos = todos;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (
      this.cachedLines !== undefined &&
      this.cachedLines.length > 0 &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push("");
    const title = th.fg("accent", " Todos ");
    const headerLine =
      th.fg("borderMuted", "─".repeat(3)) +
      title +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");

    if (this.todos.length === 0) {
      lines.push(
        truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width),
      );
    } else {
      const done = this.todos.filter((t) => t.done).length;
      const total = this.todos.length;
      lines.push(truncateToWidth(`  ${th.fg("muted", `${done}/${total} completed`)}`, width));
      lines.push("");

      for (const todo of this.todos) {
        const check = todo.done ? th.fg("success", "✓") : th.fg("dim", "○");
        const id = th.fg("accent", `#${todo.id}`);
        const text = todo.done ? th.fg("dim", todo.text) : th.fg("text", todo.text);
        lines.push(truncateToWidth(`  ${check} ${id} ${text}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
