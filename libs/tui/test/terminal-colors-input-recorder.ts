import type tuiTypes from "../src/index.types.ts";

class InputRecorder implements tuiTypes.Component {
  readonly inputs: string[] = [];

  render(_width: number): string[] {
    return [];
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  invalidate(): void {}
}

export default InputRecorder;
