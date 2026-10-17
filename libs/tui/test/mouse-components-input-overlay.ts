import { Input } from "../src/components/input.ts";
import { Container } from "../src/tui.ts";

export class InputOverlay extends Container {
  readonly input = new Input();

  constructor() {
    super();
    this.addChild(this.input);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}
