import { type Component } from "../src/index.ts";

export class InputRecorder implements Component {
  readonly inputs: string[] = [];

  render(_width: number): string[] {
    return [];
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  invalidate(): void {}
}
