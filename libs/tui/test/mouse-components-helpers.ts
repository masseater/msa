import { dual } from "effect/Function";

import { type EditorTheme } from "../src/components/editor.ts";
import { type SelectListTheme } from "../src/components/select-list.ts";
import { type SettingsListTheme } from "../src/components/settings-list.ts";
import { type TuiMouseEvent, type TuiMouseEventType } from "../src/tui-component.ts";

const mouse: {
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
    alt: false,
    button: "left",
    ctrl: false,
    height,
    screenX: x,
    screenY: y,
    shift: false,
    type,
    width,
    x,
    y,
    ...(type === "click" ? { clickCount: 1 } : {}),
  }),
);

const selectTheme: SelectListTheme = {
  description: (text) => text,
  noMatch: (text) => text,
  scrollInfo: (text) => text,
  selectedPrefix: (text) => text,
  selectedText: (text) => text,
};

const settingsTheme: SettingsListTheme = {
  cursor: "> ",
  description: (text) => text,
  hint: (text) => text,
  label: (text) => text,
  value: (text) => text,
};

const editorTheme: EditorTheme = {
  borderColor: (text) => text,
  selectList: selectTheme,
};

const mouseComponentsHelpers = {
  editorTheme,
  mouse,
  selectTheme,
  settingsTheme,
};

export default mouseComponentsHelpers;
