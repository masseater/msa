import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import CountdownTimer from "./countdown-timer.ts";
import type countdownTimerTypes from "./countdown-timer.types.ts";
import DynamicBorder from "./dynamic-border.ts";
import type extensionSelectorTypes from "./extension-selector.types.ts";
import keybindingHints from "./keybinding-hints.ts";
const { theme } = themeModule;
const { keyHint, rawKeyHint } = keybindingHints;

const { Container, Spacer, Text, getKeybindings } = tuiModule;

export default class ExtensionSelectorComponent extends tuiModule.Container {
  private options: string[];
  private selectedIndex = 0;
  private listContainer: tuiTypes.Container;
  private onSelectCallback: (option: string) => void;
  private onCancelCallback: () => void;
  private titleText: tuiTypes.Text;
  private baseTitle: string;
  private countdown: countdownTimerTypes.CountdownTimer | undefined;
  private onToggleToolsExpanded: (() => void) | undefined;

  constructor(
    title: string,
    options: string[],
    onSelect: (option: string) => void,
    onCancel: () => void,
    opts?: extensionSelectorTypes.ExtensionSelectorOptions,
  ) {
    super();

    this.options = options;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;
    this.onToggleToolsExpanded = opts?.onToggleToolsExpanded;
    this.baseTitle = title;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    this.titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
    this.addChild(this.titleText);
    if (opts?.description !== undefined && opts?.description !== "") {
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("text", opts.description), 1, 0));
    }
    this.addChild(new Spacer(1));

    if (
      opts?.timeout !== undefined &&
      opts?.timeout !== 0 &&
      opts.timeout > 0 &&
      opts.tui !== undefined
    ) {
      this.countdown = new CountdownTimer(
        opts.timeout,
        opts.tui,
        (s) => this.titleText.setText(theme.fg("accent", theme.bold(`${this.baseTitle} (${s}s)`))),
        () => this.onCancelCallback(),
      );
    }

    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    ExtensionSelectorComponent.addHintsAndBorder(this);
  }

  private static addHintsAndBorder(self: ExtensionSelectorComponent): void {
    self.addChild(
      new Text(
        rawKeyHint("↑↓", "navigate") +
          "  " +
          keyHint("tui.select.confirm", "select") +
          "  " +
          keyHint("tui.select.cancel", "cancel"),
        1,
        0,
      ),
    );
    self.addChild(new Spacer(1));
    self.addChild(new DynamicBorder());

    self.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();
    for (const [i, option] of this.options.entries()) {
      const isSelected = i === this.selectedIndex;
      const text = isSelected
        ? theme.fg("accent", "→ ") + theme.fg("accent", option)
        : `  ${theme.fg("text", option)}`;
      this.listContainer.addChild(new Text(text, 1, 0));
    }
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "app.tools.expand")) {
      this.onToggleToolsExpanded?.();
    } else if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
      this.updateList();
    } else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      const selected = this.options[this.selectedIndex];
      if (selected !== undefined && selected !== "") this.onSelectCallback(selected);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
    }
  }

  dispose(): void {
    this.countdown?.dispose();
  }
}
