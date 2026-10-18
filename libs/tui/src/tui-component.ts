import { dual } from "effect/Function";

import { isImageLine } from "./terminal-image-kitty.ts";
import { extractSegments, sliceByColumn, sliceWithWidth } from "./text-slice.ts";
import { visibleWidth } from "./utils.ts";

export type TuiMouseEventType = "press" | "release" | "move" | "drag" | "click" | "wheel";
export type TuiMouseButton = "left" | "middle" | "right" | "none";

export interface TuiMouseEvent {
  type: TuiMouseEventType;
  button: TuiMouseButton;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  wheelDelta?: number;
  clickCount?: number;
}

export interface TuiMouseEventResult {
  handled?: boolean;
  capture?: boolean;
  focus?: boolean;
  render?: boolean;
}

export interface TuiMouseDispatchTarget {
  component: Component;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface TuiMouseDispatchResult extends TuiMouseEventResult {
  handled: true;
  target: TuiMouseDispatchTarget;
  focusTarget?: Component;
}

export const dispatchMouseEvent: {
  (component: Component, event: TuiMouseEvent): TuiMouseDispatchResult | undefined;
  (event: TuiMouseEvent): (component: Component) => TuiMouseDispatchResult | undefined;
} = dual(2, (component: Component, event: TuiMouseEvent): TuiMouseDispatchResult | undefined => {
  const result = component.handleMouse?.(event);
  if (result === undefined) return undefined;
  if ("target" in result) {
    const forwarded = result as TuiMouseDispatchResult;
    return forwarded.focus === true && component.handleInput !== undefined
      ? { ...forwarded, focusTarget: component }
      : forwarded;
  }
  if (result.handled !== true && result.capture !== true && result.focus !== true) return undefined;
  return {
    ...result,
    handled: true,
    ...(result.focus === true ? { focusTarget: component } : {}),
    target: {
      component,
      originX: event.screenX - event.x,
      originY: event.screenY - event.y,
      width: event.width,
      height: event.height,
    },
  };
});

export const retargetMouseEvent: {
  (event: TuiMouseEvent, target: TuiMouseDispatchTarget): TuiMouseEvent;
  (target: TuiMouseDispatchTarget): (event: TuiMouseEvent) => TuiMouseEvent;
} = dual(2, (event: TuiMouseEvent, target: TuiMouseDispatchTarget): TuiMouseEvent => ({
  ...event,
  x: event.screenX - target.originX,
  y: event.screenY - target.originY,
  width: target.width,
  height: target.height,
}));

export interface Component {
  render(width: number): string[];

  handleInput?(data: string): void;

  handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;

  wantsKeyRelease?: boolean;

  invalidate(): void;
}

export interface Focusable {
  focused: boolean;
}

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && "focused" in component;
}

export const CURSOR_MARKER = "\x1b_pi:c\x07";

export const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
export const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";

export function unwrapFocusedFakeCursor(line: string): string {
  const marker = `${CURSOR_MARKER}${FAKE_CURSOR_START}`;
  const markerStart = line.indexOf(marker);
  if (markerStart === -1) return line;
  const contentStart = markerStart + marker.length;
  const contentEnd = line.indexOf(FAKE_CURSOR_END, contentStart);
  const content =
    contentEnd === -1 ? line.slice(contentStart) : line.slice(contentStart, contentEnd);
  const rest = contentEnd === -1 ? "" : line.slice(contentEnd + FAKE_CURSOR_END.length);
  return `${line.slice(0, markerStart)}${CURSOR_MARKER}${content}${rest}`;
}

export function renderFakeCursor(text: string): string {
  return `${FAKE_CURSOR_START}${text}${FAKE_CURSOR_END}`;
}

export class Container implements Component {
  children: Component[] = [];
  private mouseLayout?: {
    width: number;
    children: Array<{ component: Component; height: number }>;
  };

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
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

  handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
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
        const result = dispatchMouseEvent(child, {
          ...event,
          y: event.y - childY,
          height: childHeight,
        });
        if (result?.focus === true && (this as Component).handleInput !== undefined)
          return { ...result, focusTarget: this };
        return result;
      }
      childY += childHeight;
    }
    return undefined;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const mouseChildren: Array<{ component: Component; height: number }> = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      mouseChildren.push({ component: child, height: childLines.length });
      for (const line of childLines) {
        lines.push(line);
      }
    }
    this.mouseLayout = { width, children: mouseChildren };
    return lines;
  }
}

export const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

export const compositeTuiLine: {
  (
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string;
  (
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): (baseLine: string) => string;
} = dual(
  5,
  (
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string => {
    if (isImageLine(baseLine)) return baseLine;

    const afterStart = startCol + overlayWidth;
    const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
    const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);
    const beforePad = Math.max(0, startCol - base.beforeWidth);
    const overlayPad = Math.max(0, overlayWidth - overlay.width);
    const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
    const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
    const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
    const afterPad = Math.max(0, afterTarget - base.afterWidth);
    const result =
      base.before +
      " ".repeat(beforePad) +
      SEGMENT_RESET +
      overlay.text +
      " ".repeat(overlayPad) +
      SEGMENT_RESET +
      base.after +
      " ".repeat(afterPad);

    return visibleWidth(result) <= totalWidth ? result : sliceByColumn(result, 0, totalWidth, true);
  },
);
