import assert from "node:assert";
import { describe, it } from "node:test";

import { AltScreenSearchIndex, findAltScreenSearchMatches } from "../src/alt-screen-search.ts";
import { Text } from "../src/components/text.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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
