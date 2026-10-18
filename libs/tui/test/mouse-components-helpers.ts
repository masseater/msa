import { dual } from "effect/Function";

import { type EditorTheme } from "../src/components/editor.ts";
import { type SelectListTheme } from "../src/components/select-list.ts";
import { type SettingsListTheme } from "../src/components/settings-list.ts";
import { type TuiMouseEvent, type TuiMouseEventType } from "../src/tui-component.ts";

export const mouse: {
  (type: TuiMouseEventType, x: number, y: number, width?: number, height?: number): TuiMouseEvent;
  (
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): (type: TuiMouseEventType) => TuiMouseEvent;
} = dual(
  (args) => typeof args[0] === "string",
  (
    type: TuiMouseEventType,
    x: number,
    y: number,
    width: number = 80,
    height: number = 10,
  ): TuiMouseEvent => ({
    type,
    button: "left",
    x,
    y,
    screenX: x,
    screenY: y,
    width,
    height,
    shift: false,
    alt: false,
    ctrl: false,
    ...(type === "click" ? { clickCount: 1 } : {}),
  }),
);

export const selectTheme: SelectListTheme = {
  selectedPrefix: (text) => text,
  selectedText: (text) => text,
  description: (text) => text,
  scrollInfo: (text) => text,
  noMatch: (text) => text,
};

export const settingsTheme: SettingsListTheme = {
  label: (text) => text,
  value: (text) => text,
  description: (text) => text,
  cursor: "> ",
  hint: (text) => text,
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => text,
  selectList: selectTheme,
};
