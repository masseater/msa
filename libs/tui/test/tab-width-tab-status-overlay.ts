import type tuiComponentTypes from "../src/tui-component.types.ts";

class TabStatusOverlay implements tuiComponentTypes.Component {
  render(): string[] {
    return ["\tX"];
  }

  invalidate(): void {}
}

export default TabStatusOverlay;
