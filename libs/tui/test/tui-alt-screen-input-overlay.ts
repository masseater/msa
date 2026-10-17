export class InputOverlay {
  focused = false;
  inputs: string[] = [];

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  render(): string[] {
    return ["overlay"];
  }

  invalidate(): void {}
}
