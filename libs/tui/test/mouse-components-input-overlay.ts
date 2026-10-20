import Input from "../src/components/input.ts";
import tuiComponent from "../src/tui-component.ts";

const { Container } = tuiComponent;

class InputOverlay extends Container {
  readonly input = new Input();

  constructor() {
    super();
    this.addChild(this.input);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}

export default InputOverlay;
