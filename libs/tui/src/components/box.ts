import tuiComponent from "../tui-component.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import utils from "../utils.ts";

const { dispatchMouseEvent } = tuiComponent;
const { flattenLines, visibleWidth } = utils;

type RenderCache = {
  childLines: string[];
  width: number;
  bgSample: string | undefined;
  lines: string[];
};

export default class Box implements tuiComponentTypes.Component {
  children: tuiComponentTypes.Component[] = [];
  private paddingX: number;
  private paddingY: number;
  private bgFn?: ((text: string) => string) | undefined;

  private cache?: RenderCache | undefined;
  private mouseLayout?: {
    width: number;
    children: Array<{ component: tuiComponentTypes.Component; height: number }>;
  };

  constructor(paddingX = 1, paddingY = 1, bgFn?: (text: string) => string) {
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.bgFn = bgFn;
  }

  addChild(component: tuiComponentTypes.Component): void {
    this.children.push(component);
    this.invalidateCache();
  }

  removeChild(component: tuiComponentTypes.Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
      this.invalidateCache();
    }
  }

  clear(): void {
    this.children = [];
    this.invalidateCache();
  }

  setBgFn(bgFn?: (text: string) => string): void {
    this.bgFn = bgFn;
  }

  setPaddingX(paddingX: number): void {
    this.paddingX = paddingX;
    this.invalidateCache();
  }

  private invalidateCache(): void {
    this.cache = undefined;
  }

  private matchCache(width: number, childLines: string[], bgSample: string | undefined): boolean {
    const cache = this.cache;
    return (
      cache !== undefined &&
      cache.width === width &&
      cache.bgSample === bgSample &&
      cache.childLines.length === childLines.length &&
      cache.childLines.every((line, i) => line === childLines[i])
    );
  }

  invalidate(): void {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  handleMouse(
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined {
    const contentWidth = Math.max(1, event.width - this.paddingX * 2);
    const contentY = event.y - this.paddingY;
    const contentX = event.x - this.paddingX;
    if (contentY < 0 || contentX < 0 || contentX >= contentWidth) return undefined;

    const mouseChildren =
      this.mouseLayout?.width === contentWidth
        ? this.mouseLayout.children
        : this.children.map((component) => ({
            component,
            height: component.render(contentWidth).length,
          }));
    let childY = 0;
    for (const { component: child, height: childHeight } of mouseChildren) {
      if (contentY >= childY && contentY < childY + childHeight) {
        return dispatchMouseEvent(child, {
          ...event,
          height: childHeight,
          width: contentWidth,
          x: contentX,
          y: contentY - childY,
        });
      }
      childY += childHeight;
    }
    return undefined;
  }

  render(width: number): string[] {
    if (this.children.length === 0) {
      return [];
    }

    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const leftPad = " ".repeat(this.paddingX);

    const childLines: string[] = [];
    const mouseChildren: Array<{ component: tuiComponentTypes.Component; height: number }> = [];
    for (const child of this.children) {
      const lines = child.render(contentWidth);
      mouseChildren.push({ component: child, height: lines.length });
      for (const line of lines) {
        childLines.push(line);
      }
    }
    this.mouseLayout = { children: mouseChildren, width: contentWidth };

    if (childLines.length === 0) {
      return [];
    }

    const bgSample = this.bgFn === undefined ? undefined : this.bgFn("test");

    if (this.matchCache(width, childLines, bgSample)) {
      return this.cache!.lines;
    }

    const result: string[] = [];

    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }

    for (const line of childLines) {
      result.push(this.applyBg(leftPad + line, width));
    }

    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }

    flattenLines(result);
    this.cache = { bgSample, childLines, lines: result, width };

    return result;
  }

  private applyBg(line: string, width: number): string {
    const visLen = visibleWidth(line);
    const padNeeded = Math.max(0, width - visLen);
    const padded = line + " ".repeat(padNeeded);
    return this.bgFn === undefined ? padded : this.bgFn(padded);
  }
}
