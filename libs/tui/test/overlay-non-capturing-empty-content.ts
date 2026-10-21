import type tuiComponentTypes from "../src/tui-component.types.ts";

class EmptyContent implements tuiComponentTypes.Component {
  render(): string[] {
    return [];
  }
  invalidate(): void {}
}

export default EmptyContent;
