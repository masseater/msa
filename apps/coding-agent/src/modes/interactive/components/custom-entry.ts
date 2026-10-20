import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import errors from "../../../utils/errors.ts";
import themeModule from "../theme/theme.ts";

const { theme } = themeModule;
const { toErrorMessage } = errors;

const { Box, Spacer, Text } = tui;

export default class CustomEntryComponent extends tui.Container {
  private entry: sessionManagerTypes.CustomEntry<unknown>;
  private renderer: extensionsTypesTypes.EntryRenderer;
  private customComponent?: tuiTypes.Component | undefined;
  private expandedState = false;
  private outputPad: number;

  constructor(
    entry: sessionManagerTypes.CustomEntry<unknown>,
    renderer: extensionsTypesTypes.EntryRenderer,
    outputPad = 1,
  ) {
    super();
    this.entry = entry;
    this.renderer = renderer;
    this.outputPad = outputPad;
    this.rebuild();
  }

  hasContent(): boolean {
    return this.customComponent !== undefined;
  }

  setExpanded(expanded: boolean): void {
    if (this.expandedState !== expanded) {
      this.expandedState = expanded;
      this.rebuild();
    }
  }

  setOutputPad(outputPad: number): void {
    this.outputPad = outputPad;
    this.rebuild();
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();
    this.customComponent = undefined;

    let component: tuiTypes.Component | undefined;
    try {
      component = this.renderer(this.entry, { expanded: this.expandedState }, theme);
    } catch (error) {
      const message = toErrorMessage(error);
      const box = new Box(this.outputPad, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(theme.fg("error", `[${this.entry.customType}] renderer failed: ${message}`), 0, 0),
      );
      component = box;
    }

    if (component === undefined) {
      return;
    }

    this.customComponent = component;
    this.addChild(new Spacer(1));
    this.addChild(component);
  }
}
