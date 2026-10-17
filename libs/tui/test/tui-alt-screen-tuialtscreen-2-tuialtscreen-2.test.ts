import assert from "node:assert";
import { describe, it } from "node:test";

import { AltScreenSearchComponent } from "../src/alt-screen-search.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";

describe("TuiAltScreen", () => {
  it("renders transcript search with a muted placeholder and right-aligned controls", () => {
    const component = new AltScreenSearchComponent(() => {});
    const rendered = component.render(48);
    const lines = rendered.map((line) => stripTerminalSequences(line));

    assert.strictEqual(lines.length, 3);
    assert.ok(lines.every((line) => visibleWidth(line) === 48));
    assert.match(lines[0] ?? "", /^┌─+┐$/u);
    assert.match(lines[1] ?? "", /^│ Find in transcript +│$/u);
    assert.ok(rendered[1]?.includes("\x1b[2m"));
    assert.match(lines[2] ?? "", /^└─+ ↑ Shift\+Enter · ↓ Enter ─┘$/u);
    const controls = lines[2] ?? "";
    assert.strictEqual(component.getNavigationDirectionAt(2, controls.indexOf("↑")), -1);
    assert.strictEqual(
      component.getNavigationDirectionAt(2, controls.indexOf("Shift+Enter") + 5),
      -1,
    );
    assert.strictEqual(component.getNavigationDirectionAt(2, controls.indexOf("·")), undefined);
    assert.strictEqual(component.getNavigationDirectionAt(2, controls.indexOf("↓")), 1);
    assert.strictEqual(component.getNavigationDirectionAt(2, controls.lastIndexOf("Enter") + 2), 1);

    component.handleInput("n");
    component.setResult(0, 2);
    const populatedRender = component.render(48);
    const populated = populatedRender.map((line) => stripTerminalSequences(line));
    assert.ok(populated[1]?.includes("n"));
    assert.ok(populated[1]?.includes("1/2"));
    assert.ok(populatedRender[1]?.includes("\x1b[2m 1/2 \x1b[22m"));
    assert.ok(!populated.some((line) => line.includes("Find in transcript")));
  });
});
