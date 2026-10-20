import assert from "node:assert";
import { describe, it } from "node:test";

import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
} from "../src/components/settings-list.ts";

const testTheme: SettingsListTheme = {
  cursor: "> ",
  description: (text) => text,
  hint: (text) => text,
  label: (text) => text,
  value: (text) => text,
};

function createItems(): SettingItem[] {
  return [
    {
      currentValue: "regular",
      id: "tui-mode",
      label: "TUI mode",
      values: ["regular", "fullscreen"],
    },
  ];
}

describe("SettingsList", () => {
  it("includes spaces in an active search instead of changing the selected setting", () => {
    const changes: Array<{ id: string; value: string }> = [];
    const list = new SettingsList(
      createItems(),
      10,
      testTheme,
      (id, value) => changes.push({ id, value }),
      () => {},
      { enableSearch: true },
    );

    for (const character of "TUI mode") list.handleInput(character);

    assert.deepStrictEqual(changes, []);
    assert.match(list.render(80)[0] ?? "", /TUI mode/u);

    list.handleInput("\r");
    assert.deepStrictEqual(changes, [{ id: "tui-mode", value: "fullscreen" }]);
  });

  it("keeps Space as a change shortcut before a search query is entered", () => {
    const changes: Array<{ id: string; value: string }> = [];
    const list = new SettingsList(
      createItems(),
      10,
      testTheme,
      (id, value) => changes.push({ id, value }),
      () => {},
      { enableSearch: true },
    );

    list.handleInput(" ");

    assert.deepStrictEqual(changes, [{ id: "tui-mode", value: "fullscreen" }]);
  });
});
