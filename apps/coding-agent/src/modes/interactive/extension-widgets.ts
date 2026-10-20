import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypes from "../../core/extensions/index.types.ts";
import ThemedText from "./components/themed-text.ts";
import type extensionWidgetsTypes from "./extension-widgets.types.ts";
import themeModule from "./theme/theme.ts";

const { theme } = themeModule;
const { Container, Spacer, Text } = tuiModule;

const MAX_WIDGET_LINES = 10;

export default class ExtensionWidgets {
  readonly above = new Container();
  readonly below = new Container();
  private readonly ui: tuiTypes.TUI;
  private readonly aboveWidgets = new Map<string, extensionWidgetsTypes.Widget>();
  private readonly belowWidgets = new Map<string, extensionWidgetsTypes.Widget>();

  constructor(ui: tuiTypes.TUI) {
    this.ui = ui;
    this.fill();
  }

  set(
    key: string,
    content: extensionWidgetsTypes.WidgetContent | undefined,
    options?: extensionsTypes.ExtensionWidgetOptions,
  ): void {
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

function createTextWidget(lines: readonly string[]): tuiTypes.Container {
  const container = new Container();
  for (const line of lines.slice(0, MAX_WIDGET_LINES)) {
    container.addChild(new Text(line, 1, 0));
  }
  if (lines.length > MAX_WIDGET_LINES) {
    container.addChild(new ThemedText(() => theme.fg("muted", "... (widget truncated)"), 1, 0));
  }
  return container;
}
