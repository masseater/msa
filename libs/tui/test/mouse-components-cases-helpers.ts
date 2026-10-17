import assert from "node:assert";
import { it } from "node:test";

import { SelectList } from "../src/components/select-list.ts";
import { SettingsList } from "../src/components/settings-list.ts";
import { mouse, selectTheme, settingsTheme } from "./mouse-components-helpers.ts";

export function mouseAwareComponentsCases1(): void {
  for (const row of [0, 4]) {
    it(`ignores hover and clicks visible select-list row ${row} after scrolling`, () => {
      selectListScrollCase(row);
    });

    it(`ignores hover and clicks visible settings row ${row} after scrolling`, () => {
      settingsListScrollCase(row);
    });
  }
}

function selectListScrollCase(row: number): void {
  const list = new SelectList(
    Array.from({ length: 12 }, (_, i) => ({ value: `item-${i}`, label: `Item ${i}` })),
    5,
    selectTheme,
  );
  const changes: string[] = [];
  let selected: string | undefined;
  list.onSelectionChange = (item) => changes.push(item.value);
  list.onSelect = (item) => {
    selected = item.value;
  };
  list.setSelectedIndex(5);
  list.handleMouse({ ...mouse("wheel", 1, row), wheelDelta: 1 });
  assert.strictEqual(list.getSelectedItem()?.value, "item-6");
  assert.deepStrictEqual(changes, ["item-6"]);
  const before = list.render(80);
  assert.match(before[row] ?? "", new RegExp(`Item ${4 + row}$`, "u"));

  for (const y of [0, 1, 2, 3, 4, row]) {
    assert.strictEqual(list.handleMouse({ ...mouse("move", 1, y), button: "none" }), undefined);
    assert.deepStrictEqual(list.render(80), before);
  }
  assert.strictEqual(list.getSelectedItem()?.value, "item-6");
  assert.deepStrictEqual(changes, ["item-6"]);
  assert.strictEqual(selected, undefined);

  list.handleMouse(mouse("press", 1, row));
  list.render(80);
  list.handleMouse(mouse("click", 1, row));
  assert.strictEqual(selected, `item-${4 + row}`);
  assert.deepStrictEqual(changes, ["item-6", `item-${4 + row}`]);
}

function settingsListScrollCase(row: number): void {
  const changes: Array<{ id: string; value: string }> = [];
  const list = new SettingsList(
    Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
      description: `Description ${i}`,
      currentValue: "off",
      values: ["off", "on"],
    })),
    5,
    settingsTheme,
    (id, value) => changes.push({ id, value }),
    () => {},
    { enableSearch: true },
  );
  list.selectItem("item-5");
  list.handleMouse({ ...mouse("wheel", 1, row + 2), wheelDelta: 1 });
  const before = list.render(80);
  assert.match(before[4] ?? "", /^> Item 6/u);
  assert.match(before[row + 2] ?? "", new RegExp(`Item ${4 + row} `, "u"));

  for (const y of [0, 1, 2, 3, 4, row]) {
    assert.strictEqual(list.handleMouse({ ...mouse("move", 1, y + 2), button: "none" }), undefined);
    assert.deepStrictEqual(list.render(80), before);
  }
  assert.deepStrictEqual(changes, []);

  list.handleMouse(mouse("press", 1, row + 2));
  list.render(80);
  list.handleMouse(mouse("click", 1, row + 2));
  assert.deepStrictEqual(changes, [{ id: `item-${4 + row}`, value: "on" }]);
}
