import TestComponent from "./tui-render-test-component.ts";

class InputComponent extends TestComponent {
  renderCount = 0;

  override render(width: number): string[] {
    this.renderCount += 1;
    return super.render(width);
  }

  handleInput(data: string): void {
    this.lines = [data];
  }
}

export default InputComponent;
