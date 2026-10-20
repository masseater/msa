import { dual } from "effect/Function";

import Container from "./container.ts";
import terminalImageKitty from "./terminal-image-kitty.ts";
import textSlice from "./text-slice.ts";
import type tuiComponentTypes from "./tui-component.types.ts";
import utils from "./utils.ts";

const { isImageLine } = terminalImageKitty;
const { extractSegments, sliceByColumn, sliceWithWidth } = textSlice;
const { visibleWidth } = utils;

const dispatchMouseEvent: {
  (
    component: tuiComponentTypes.Component,
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined;
  (
    event: tuiComponentTypes.TuiMouseEvent,
  ): (
    component: tuiComponentTypes.Component,
  ) => tuiComponentTypes.TuiMouseDispatchResult | undefined;
} = dual(
  2,
  (
    component: tuiComponentTypes.Component,
    event: tuiComponentTypes.TuiMouseEvent,
  ): tuiComponentTypes.TuiMouseDispatchResult | undefined => {
    const result = component.handleMouse?.(event);
    if (result === undefined) return undefined;
    if ("target" in result) {
      const forwarded = result as tuiComponentTypes.TuiMouseDispatchResult;
      return forwarded.focus === true && component.handleInput !== undefined
        ? { ...forwarded, focusTarget: component }
        : forwarded;
    }
    if (result.handled !== true && result.capture !== true && result.focus !== true)
      return undefined;
    return {
      ...result,
      handled: true,
      ...(result.focus === true ? { focusTarget: component } : {}),
      target: {
        component,
        height: event.height,
        originX: event.screenX - event.x,
        originY: event.screenY - event.y,
        width: event.width,
      },
    };
  },
);

const retargetMouseEvent: {
  (
    event: tuiComponentTypes.TuiMouseEvent,
    target: tuiComponentTypes.TuiMouseDispatchTarget,
  ): tuiComponentTypes.TuiMouseEvent;
  (
    target: tuiComponentTypes.TuiMouseDispatchTarget,
  ): (event: tuiComponentTypes.TuiMouseEvent) => tuiComponentTypes.TuiMouseEvent;
} = dual(
  2,
  (
    event: tuiComponentTypes.TuiMouseEvent,
    target: tuiComponentTypes.TuiMouseDispatchTarget,
  ): tuiComponentTypes.TuiMouseEvent => ({
    ...event,
    height: target.height,
    width: target.width,
    x: event.screenX - target.originX,
    y: event.screenY - target.originY,
  }),
);

function isFocusable(
  component: tuiComponentTypes.Component | null,
): component is tuiComponentTypes.Component & tuiComponentTypes.Focusable {
  return component !== null && "focused" in component;
}

const CURSOR_MARKER = "\x1b_pi:c\x07";

const FAKE_CURSOR_START = "\x1b_pi:fc\x07";
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";

function unwrapFocusedFakeCursor(line: string): string {
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

function renderFakeCursor(text: string): string {
  return `${FAKE_CURSOR_START}${text}${FAKE_CURSOR_END}`;
}

const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

const compositeTuiLine: {
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

const tuiComponent = {
  CURSOR_MARKER,
  Container,
  FAKE_CURSOR_END,
  FAKE_CURSOR_START,
  SEGMENT_RESET,
  compositeTuiLine,
  dispatchMouseEvent,
  isFocusable,
  renderFakeCursor,
  retargetMouseEvent,
  unwrapFocusedFakeCursor,
};

export default tuiComponent;
