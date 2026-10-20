import { dual } from "effect/Function";

import type editorTypes from "../src/components/editor.types.ts";
import type selectListTypes from "../src/components/select-list.types.ts";
import type settingsListTypes from "../src/components/settings-list.types.ts";
import type tuiComponentTypes from "../src/tui-component.types.ts";

const mouse: {
  (
    type: tuiComponentTypes.TuiMouseEventType,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): tuiComponentTypes.TuiMouseEvent;
  (
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): (type: tuiComponentTypes.TuiMouseEventType) => tuiComponentTypes.TuiMouseEvent;
} = dual(
  (args) => typeof args[0] === "string",
  (
    type: tuiComponentTypes.TuiMouseEventType,
    x: number,
    y: number,
    width: number = 80,
    height: number = 10,
  ): tuiComponentTypes.TuiMouseEvent => ({
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

const selectTheme: selectListTypes.SelectListTheme = {
  description: (text) => text,
  noMatch: (text) => text,
  scrollInfo: (text) => text,
  selectedPrefix: (text) => text,
  selectedText: (text) => text,
};

const settingsTheme: settingsListTypes.SettingsListTheme = {
  cursor: "> ",
  description: (text) => text,
  hint: (text) => text,
  label: (text) => text,
  value: (text) => text,
};

const editorTheme: editorTypes.EditorTheme = {
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
