import tuiComponent from "../tui-component.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import type mouseRegionTypes from "./mouse-region.types.ts";

const { dispatchMouseEvent } = tuiComponent;

export default class MouseRegion implements tuiComponentTypes.Component {
  private readonly child: tuiComponentTypes.Component;
  private readonly onMouse: mouseRegionTypes.MouseRegionHandler;

  constructor(child: tuiComponentTypes.Component, onMouse: mouseRegionTypes.MouseRegionHandler) {
    this.child = child;
    this.onMouse = onMouse;
  }

  render(width: number): string[] {
    return this.child.render(width);
  }

  handleMouse(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | tuiComponentTypes.TuiMouseEventResult | undefined {
    const childResult = dispatchMouseEvent(this.child, event);
    return childResult ?? this.onMouse(event);
  }

  invalidate(): void {
    this.child.invalidate();
  }
}
