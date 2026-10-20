import assert from "node:assert";
import { describe, it } from "node:test";

import { AltScreenSearchComponent } from "../src/alt-screen-search-component.ts";
import { AltScreenSearchIndex, findAltScreenSearchMatches } from "../src/alt-screen-search.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";

describe("TuiAltScreen", () => {
  searchesNormalizedRenderedTranscriptText();
  reusesIndexedTranscriptMatchesUntil();
  rendersTranscriptSearchMutedPlaceholder();
});

function searchesNormalizedRenderedTranscriptText(): void {
  it("searches normalized rendered transcript text across rows", () => {
    assert.deepStrictEqual(
      findAltScreenSearchMatches(["alpha QUICK", "brown fox"], "quick brown"),
      [
        {
          segments: [
            { endCol: 11, row: 0, startCol: 6 },
            { endCol: 5, row: 1, startCol: 0 },
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
            { endCol: 3, row: 0, startCol: 1 },
            { endCol: 8, row: 0, startCol: 5 },
            { endCol: 6, row: 1, startCol: 0 },
          ],
        },
      ],
    );
  });
}

function reusesIndexedTranscriptMatchesUntil(): void {
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
    assert.deepStrictEqual(changedQuery.matches[0]?.segments, [{ endCol: 5, row: 1, startCol: 0 }]);

    const changedLines = index.search(["alpha needle", "no match"], "omega");
    assert.strictEqual(changedLines.changed, true);
    assert.deepStrictEqual(changedLines.matches, []);
  });
}

function rendersTranscriptSearchMutedPlaceholder(): void {
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
}
