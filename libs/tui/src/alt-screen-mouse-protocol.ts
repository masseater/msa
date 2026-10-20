import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import ansiSequences from "./ansi-sequences.ts";
import env from "./env.ts";
import type tuiComponentTypes from "./tui-component.types.ts";

const { matchCsiSequence } = ansiSequences;
const { readEnv } = env;

const SGR_MOUSE_BODY = /^<(\d+);(\d+);(\d+)$/u;
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

function focusEvent(data: string): "in" | "out" | undefined {
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

function parseWheelEvent(data: string): altScreenMouseProtocolTypes.WheelEvent | undefined {
  const [, sgrButton, sgrX, sgrY] =
    matchCsiSequence({ body: SGR_MOUSE_BODY, data, finals: "Mm" })?.groups ?? [];
  if (sgrButton !== undefined && sgrX !== undefined && sgrY !== undefined) {
    const button = Number.parseInt(sgrButton, 10);
    const direction = wheelDirection(button);
    if (direction === undefined) return undefined;
    return {
      button,
      direction,
      x: Number.parseInt(sgrX, 10) - 1,
      y: Number.parseInt(sgrY, 10) - 1,
    };
  }
  if (legacyMouseSequence(data)) {
    const button = data.charCodeAt(3) - 32;
    const direction = wheelDirection(button);
    if (direction === undefined) return undefined;
    return { button, direction, x: data.charCodeAt(4) - 33, y: data.charCodeAt(5) - 33 };
  }
  return undefined;
}

function parseSgrMouseEvent(data: string): altScreenMouseProtocolTypes.SgrMouseEvent | undefined {
  const mouse = matchCsiSequence({ body: SGR_MOUSE_BODY, data, finals: "Mm" });
  const [, button, x, y] = mouse?.groups ?? [];
  const final = mouse?.final;
  if (button === undefined || x === undefined || y === undefined) return undefined;
  return {
    button: Number.parseInt(button, 10),
    release: final === "m",
    x: Number.parseInt(x, 10) - 1,
    y: Number.parseInt(y, 10) - 1,
  };
}

function isMouseSequence(data: string): boolean {
  return (
    matchCsiSequence({ body: SGR_MOUSE_BODY, data, finals: "Mm" }) !== null ||
    legacyMouseSequence(data)
  );
}

function decodeMouseButton(button: number): tuiComponentTypes.TuiMouseButton {
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

function isPlainPress(event: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
  return !event.release && (event.button & 32) === 0 && (event.button & 3) === 0;
}

function rawEventType(
  raw: altScreenMouseProtocolTypes.SgrMouseEvent,
): tuiComponentTypes.TuiMouseEvent["type"] {
  if (raw.release) return "release";
  if ((raw.button & 32) === 0) return "press";
  return decodeMouseButton(raw.button) === "none" ? "move" : "drag";
}

function shouldPasteOnRightClick(event: altScreenMouseProtocolTypes.SgrMouseEvent): boolean {
  return (
    process.platform === "win32" &&
    readEnv("TERM_PROGRAM")?.toLowerCase() !== "vscode" &&
    !event.release &&
    event.button === 2
  );
}

function createMouseEvent(
  spec: altScreenMouseProtocolTypes.MouseEventSpec,
): tuiComponentTypes.TuiMouseEvent {
  const { type, button, x, y } = spec;
  return {
    alt: (button & 8) !== 0,
    button: type === "wheel" ? "none" : decodeMouseButton(button),
    ctrl: (button & 16) !== 0,
    height: Math.max(1, spec.rows),
    screenX: x,
    screenY: y,
    shift: (button & 4) !== 0,
    type,
    width: Math.max(1, spec.columns),
    x,
    y,
    ...(spec.wheelDelta === undefined ? {} : { wheelDelta: spec.wheelDelta }),
    ...(spec.clickCount === undefined ? {} : { clickCount: spec.clickCount }),
  };
}

const altScreenMouseProtocol = {
  createMouseEvent,
  decodeMouseButton,
  focusEvent,
  isMouseSequence,
  isPlainPress,
  parseSgrMouseEvent,
  parseWheelEvent,
  rawEventType,
  shouldPasteOnRightClick,
};

export default altScreenMouseProtocol;
