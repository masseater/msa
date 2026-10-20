import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

const { Container, Input, Spacer, Text, getKeybindings } = tuiModule;

export interface ExtensionInputOptions {
  tui?: tuiTypes.TUI | undefined;
  timeout?: number | undefined;
  initialValue?: string | undefined;
  description?: string | undefined;
}

export class ExtensionInputComponent extends Container implements tuiTypes.Focusable {
  private input: tuiTypes.Input;
  private onSubmitCallback: (value: string) => void;
  private onCancelCallback: () => void;
  private titleText: tuiTypes.Text;
  private baseTitle: string;
  private countdown: CountdownTimer | undefined;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  constructor(
    title: string,
    _placeholder: string | undefined,
    onSubmit: (value: string) => void,
    onCancel: () => void,
    opts?: ExtensionInputOptions,
  ) {
    super();

    this.onSubmitCallback = onSubmit;
    this.onCancelCallback = onCancel;
    this.baseTitle = title;

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    this.titleText = new Text(theme.fg("accent", title), 1, 0);
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
        (s) => this.titleText.setText(theme.fg("accent", `${this.baseTitle} (${s}s)`)),
        () => this.onCancelCallback(),
      );
    }

    this.input = new Input();
    ExtensionInputComponent.buildPart1(this, opts);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }

  private static buildPart1(
    self: ExtensionInputComponent,
    opts: ExtensionInputOptions | undefined,
  ): void {
    if (opts?.initialValue !== undefined && opts?.initialValue !== "")
      self.input.setValue(opts.initialValue);
    self.addChild(self.input);
    self.addChild(new Spacer(1));
    self.addChild(
      new Text(
        `${keyHint("tui.select.confirm", "submit")}  ${keyHint("tui.select.cancel", "cancel")}`,
        1,
        0,
      ),
    );
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
      this.onSubmitCallback(this.input.getValue());
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
    } else {
      this.input.handleInput(keyData);
    }
  }

  dispose(): void {
    this.countdown?.dispose();
  }
}
