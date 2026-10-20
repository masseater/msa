import type tuiComponentTypes from "../../../libs/tui/src/tui-component.types.ts";

export default class TestFocusableComponent
  implements tuiComponentTypes.Component, tuiComponentTypes.Focusable
{
  focused = false;
  inputs: string[] = [];
  private readonly label: string;
  private text = "";

  constructor(label: string) {
    this.label = label;
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
  }

  render(): string[] {
    return [this.label];
  }

  invalidate(): void {}
}
