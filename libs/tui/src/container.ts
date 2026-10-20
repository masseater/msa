import tuiComponentModule from "./tui-component.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

export default class Container implements tuiComponentTypes.Component {
  children: tuiComponentTypes.Component[] = [];
  private mouseLayout?: {
    width: number;
    children: Array<{ component: tuiComponentTypes.Component; height: number }>;
  };

  addChild(component: tuiComponentTypes.Component): void {
    this.children.push(component);
  }

  removeChild(component: tuiComponentTypes.Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  handleMouse(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined {
    if (event.y < 0 || event.y >= event.height) return undefined;
    const mouseChildren =
      this.mouseLayout?.width === event.width
        ? this.mouseLayout.children
        : this.children.map((component) => ({
            component,
            height: component.render(event.width).length,
          }));
    let childY = 0;
    for (const { component: child, height: childHeight } of mouseChildren) {
      if (event.y >= childY && event.y < childY + childHeight) {
        const result = tuiComponentModule.dispatchMouseEvent(child, {
          ...event,
          height: childHeight,
          y: event.y - childY,
        });
        if (
          result?.focus === true &&
          (this as tuiComponentTypes.Component).handleInput !== undefined
        )
          return { ...result, focusTarget: this };
        return result;
      }
      childY += childHeight;
    }
    return undefined;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const mouseChildren: Array<{ component: tuiComponentTypes.Component; height: number }> = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      mouseChildren.push({ component: child, height: childLines.length });
      for (const line of childLines) {
        lines.push(line);
      }
    }
    this.mouseLayout = { children: mouseChildren, width };
    return lines;
  }
}
