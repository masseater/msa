import assert from "node:assert";
import { describe, it } from "node:test";

import {
  AltScreenSearchComponent,
  AltScreenSearchIndex,
  findAltScreenSearchMatches,
} from "../src/alt-screen-search.ts";
import { MouseRegion } from "../src/components/mouse-region.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("jumps to a scrollbar track position and continues dragging from there", async () => {
    const terminal = new RecordingTerminal(10, 10);
    const tui = new TuiAltScreen(terminal);
    const scrollView = new ScrollView(
      new Text(Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      { primary: true, scrollbar: "always" },
    );
    tui.setLayoutRoot(scrollView);
    tui.start();
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 0);

    terminal.sendInput("\x1b[<0;10;6M");
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 20);

    terminal.sendInput("\x1b[<32;10;10M");
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 40);

    terminal.sendInput("\x1b[<0;10;10m");
    await terminal.waitForRender();
    assert.ok(
      terminal.events.every(
        (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
      ),
    );
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  // #9758: wheel line counts can change at runtime; Alt keeps its multiplier.
  it("applies runtime wheel line count updates", async () => {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
    const deltas: Array<number | undefined> = [];
    tui.addChild(
      new MouseRegion(new Text("wheel target", 0, 0), (event) => {
        if (event.type !== "wheel") return undefined;
        deltas.push(event.wheelDelta);
        return { handled: true };
      }),
    );
    tui.start();
    try {
      await terminal.waitForRender();
      terminal.sendInput("\x1b[<64;1;1M");
      tui.setWheelScrollLines(2);
      terminal.sendInput("\x1b[<65;1;1M");
      terminal.sendInput("\x1b[<72;1;1M");
      assert.deepStrictEqual(deltas, [-3, 2, -10]);
    } finally {
      tui.stop();
    }
  });
});

describe("TuiAltScreen", () => {
  it("chains unused wheel delta to an outer scroll view", async () => {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
    const inner = new ScrollView(new Text("i1\ni2\ni3\ni4\ni5\ni6", 0, 0));
    const outer = new ScrollView(
      new VStack([
        { component: inner, basis: 2 },
        new Text("tail1\ntail2\ntail3\ntail4\ntail5", 0, 0),
      ]),
      { primary: true },
    );
    tui.setLayoutRoot(outer);
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<65;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(inner.scrollTop, 3);
    assert.strictEqual(outer.scrollTop, 0);

    terminal.sendInput("\x1b[<65;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(inner.scrollTop, 4);
    assert.strictEqual(outer.scrollTop, 2);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("supports configurable keyboard viewport navigation with four rows of page overlap", async () => {
    const terminal = new VirtualTerminal(20, 8);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
    );
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[57421u");
    terminal.sendInput("\x1b[57421;1:3u");
    await terminal.waitForRender();
    assert.deepStrictEqual(
      terminal.getViewport().map((line) => line.trimEnd()),
      ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8"],
    );

    terminal.sendInput("\x1b[57422u");
    terminal.sendInput("\x1b[57422;1:3u");
    await terminal.waitForRender();
    assert.deepStrictEqual(
      terminal.getViewport().map((line) => line.trimEnd()),
      ["line 5", "line 6", "line 7", "line 8", "line 9", "line 10", "line 11", "line 12"],
    );

    terminal.sendInput("\x1b[7^");
    await terminal.waitForRender();
    assert.deepStrictEqual(
      terminal.getViewport().map((line) => line.trimEnd()),
      ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8"],
    );

    terminal.sendInput("\x1b[8^");
    await terminal.waitForRender();
    assert.deepStrictEqual(
      terminal.getViewport().map((line) => line.trimEnd()),
      ["line 5", "line 6", "line 7", "line 8", "line 9", "line 10", "line 11", "line 12"],
    );

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("searches normalized rendered transcript text across rows", () => {
    assert.deepStrictEqual(
      findAltScreenSearchMatches(["alpha QUICK", "brown fox"], "quick brown"),
      [
        {
          segments: [
            { row: 0, startCol: 6, endCol: 11 },
            { row: 1, startCol: 0, endCol: 5 },
          ],
        },
      ],
    );
  });

  it("maps normalized ASCII and Unicode search matches back to rendered columns", () => {
    assert.deepStrictEqual(
      findAltScreenSearchMatches(["\x1b[31mfoo  bar\x1b[0m", "A界🙂éZ"], "oo   bar\nA界🙂é"),
      [
        {
          segments: [
            { row: 0, startCol: 1, endCol: 3 },
            { row: 0, startCol: 5, endCol: 8 },
            { row: 1, startCol: 0, endCol: 6 },
          ],
        },
      ],
    );
  });
});

describe("TuiAltScreen", () => {
  it("reuses indexed transcript matches until the query or rendered lines change", () => {
    const index = new AltScreenSearchIndex();
    const initial = index.search(["alpha needle", "omega"], "needle");
    assert.strictEqual(initial.changed, true);
    assert.strictEqual(initial.matches.length, 1);

    const cached = index.search(["alpha needle", "omega"], "needle");
    assert.strictEqual(cached.changed, false);
    assert.strictEqual(cached.matches, initial.matches);

    const changedQuery = index.search(["alpha needle", "omega"], "omega");
    assert.strictEqual(changedQuery.changed, true);
    assert.notStrictEqual(changedQuery.matches, initial.matches);
    assert.deepStrictEqual(changedQuery.matches[0]?.segments, [{ row: 1, startCol: 0, endCol: 5 }]);

    const changedLines = index.search(["alpha needle", "no match"], "omega");
    assert.strictEqual(changedLines.changed, true);
    assert.deepStrictEqual(changedLines.matches, []);
  });
});

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
