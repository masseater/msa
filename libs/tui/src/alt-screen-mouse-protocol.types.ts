import type tuiComponentTypes from "./tui-component.types.ts";

declare namespace altScreenMouseProtocolTypes {
  interface SgrMouseEvent {
    button: number;
    x: number;
    y: number;
    release: boolean;
  }

  interface WheelEvent {
    direction: -1 | 1;
    x: number;
    y: number;
    button: number;
  }

  interface MouseEventSpec {
    type: tuiComponentTypes.TuiMouseEvent["type"];
    button: number;
    x: number;
    y: number;
    columns: number;
    rows: number;
    wheelDelta?: number;
    clickCount?: number;
  }
}

export type { altScreenMouseProtocolTypes as default };
