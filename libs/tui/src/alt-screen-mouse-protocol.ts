import { matchCsiSequence } from "./ansi-sequences.ts";
import { readEnv } from "./env.ts";
import type { TuiMouseButton, TuiMouseEvent } from "./tui-component.ts";

const SGR_MOUSE_BODY = /^<(\d+);(\d+);(\d+)$/u;
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

export interface SgrMouseEvent {
  button: number;
  x: number;
  y: number;
  release: boolean;
}

export interface WheelEvent {
  direction: -1 | 1;
  x: number;
  y: number;
  button: number;
}

export interface MouseEventSpec {
  type: TuiMouseEvent["type"];
  button: number;
  x: number;
  y: number;
  columns: number;
  rows: number;
  wheelDelta?: number;
  clickCount?: number;
}

export function focusEvent(data: string): "in" | "out" | undefined {
  if (data === FOCUS_OUT) return "out";
  if (data === FOCUS_IN) return "in";
  return undefined;
}

function legacyMouseSequence(data: string): boolean {
  return data.length === 6 && data.startsWith("\x1b[M");
}

function wheelDirection(button: number): -1 | 1 | undefined {
  if ((button & 64) === 0) return undefined;
  const direction = button & 3;
  if (direction === 0) return -1;
  if (direction === 1) return 1;
  return undefined;
}

export function parseWheelEvent(data: string): WheelEvent | undefined {
  const [, sgrButton, sgrX, sgrY] =
    matchCsiSequence({ data, finals: "Mm", body: SGR_MOUSE_BODY })?.groups ?? [];
  if (sgrButton !== undefined && sgrX !== undefined && sgrY !== undefined) {
    const button = Number.parseInt(sgrButton, 10);
    const direction = wheelDirection(button);
    if (direction === undefined) return undefined;
    return {
      direction,
      x: Number.parseInt(sgrX, 10) - 1,
      y: Number.parseInt(sgrY, 10) - 1,
      button,
    };
  }
  if (legacyMouseSequence(data)) {
    const button = data.charCodeAt(3) - 32;
    const direction = wheelDirection(button);
    if (direction === undefined) return undefined;
    return { direction, x: data.charCodeAt(4) - 33, y: data.charCodeAt(5) - 33, button };
  }
  return undefined;
}

export function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
  const mouse = matchCsiSequence({ data, finals: "Mm", body: SGR_MOUSE_BODY });
  const [, button, x, y] = mouse?.groups ?? [];
  const final = mouse?.final;
  if (button === undefined || x === undefined || y === undefined) return undefined;
  return {
    button: Number.parseInt(button, 10),
    x: Number.parseInt(x, 10) - 1,
    y: Number.parseInt(y, 10) - 1,
    release: final === "m",
  };
}

export function isMouseSequence(data: string): boolean {
  return (
    matchCsiSequence({ data, finals: "Mm", body: SGR_MOUSE_BODY }) !== null ||
    legacyMouseSequence(data)
  );
}

export function decodeMouseButton(button: number): TuiMouseButton {
  switch (button & 3) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "none";
  }
}

export function isPlainPress(event: SgrMouseEvent): boolean {
  return !event.release && (event.button & 32) === 0 && (event.button & 3) === 0;
}

export function rawEventType(raw: SgrMouseEvent): TuiMouseEvent["type"] {
  if (raw.release) return "release";
  if ((raw.button & 32) === 0) return "press";
  return decodeMouseButton(raw.button) === "none" ? "move" : "drag";
}

export function shouldPasteOnRightClick(event: SgrMouseEvent): boolean {
  return (
    process.platform === "win32" &&
    readEnv("TERM_PROGRAM")?.toLowerCase() !== "vscode" &&
    !event.release &&
    event.button === 2
  );
}

export function createMouseEvent(spec: MouseEventSpec): TuiMouseEvent {
  const { type, button, x, y } = spec;
  return {
    type,
    button: type === "wheel" ? "none" : decodeMouseButton(button),
    x,
    y,
    screenX: x,
    screenY: y,
    width: Math.max(1, spec.columns),
    height: Math.max(1, spec.rows),
    shift: (button & 4) !== 0,
    alt: (button & 8) !== 0,
    ctrl: (button & 16) !== 0,
    ...(spec.wheelDelta === undefined ? {} : { wheelDelta: spec.wheelDelta }),
    ...(spec.clickCount === undefined ? {} : { clickCount: spec.clickCount }),
  };
}
