import { type Component, Container, Spacer, Text, type TUI } from "@msa/tui";

import type { ExtensionWidgetOptions } from "../../core/extensions/index.ts";
import { ThemedText } from "./components/themed-text.ts";
import { type Theme, theme } from "./theme/theme.ts";

type Widget = Component & { dispose?(): void };
export type WidgetContent = string[] | ((tui: TUI, thm: Theme) => Widget);

const MAX_WIDGET_LINES = 10;

export class ExtensionWidgets {
  readonly above = new Container();
  readonly below = new Container();
  private readonly ui: TUI;
  private readonly aboveWidgets = new Map<string, Widget>();
  private readonly belowWidgets = new Map<string, Widget>();

  constructor(ui: TUI) {
    this.ui = ui;
    this.fill();
  }

  set(key: string, content: WidgetContent | undefined, options?: ExtensionWidgetOptions): void {
    for (const widgets of [this.aboveWidgets, this.belowWidgets]) {
      widgets.get(key)?.dispose?.();
      widgets.delete(key);
    }
    if (content !== undefined) {
      const widgets = options?.placement === "belowEditor" ? this.belowWidgets : this.aboveWidgets;
      widgets.set(
        key,
        Array.isArray(content) ? createTextWidget(content) : content(this.ui, theme),
      );
    }
    this.fill();
    this.ui.requestRender();
  }

  clear(): void {
    for (const widgets of [this.aboveWidgets, this.belowWidgets]) {
      for (const widget of widgets.values()) widget.dispose?.();
      widgets.clear();
    }
    this.fill();
    this.ui.requestRender();
  }

  private fill(): void {
    this.above.clear();
    this.above.addChild(new Spacer(1));
    for (const widget of this.aboveWidgets.values()) this.above.addChild(widget);

    this.below.clear();
    for (const widget of this.belowWidgets.values()) this.below.addChild(widget);
  }
}

function createTextWidget(lines: readonly string[]): Container {
  const container = new Container();
  for (const line of lines.slice(0, MAX_WIDGET_LINES)) {
    container.addChild(new Text(line, 1, 0));
  }
  if (lines.length > MAX_WIDGET_LINES) {
    container.addChild(new ThemedText(() => theme.fg("muted", "... (widget truncated)"), 1, 0));
  }
  return container;
}
