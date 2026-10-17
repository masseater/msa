import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { extractSegments, sliceWithWidth } from "../src/text-slice.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { normalizeTerminalOutput, visibleWidth } from "../src/utils.ts";
import { CapturingVirtualTerminal } from "./tab-width-capturing-virtual-terminal.ts";
import { FullViewportContent } from "./tab-width-full-viewport-content.ts";
import { TabStatusOverlay } from "./tab-width-tab-status-overlay.ts";

describe("tab width accounting", () => {
  it("keeps slice helper widths consistent with visible width", () => {
    const text = "out 192M\t.msa/skill-tests/results-ha";
    const slice = sliceWithWidth(text, 0, 10, true);

    assert.strictEqual(slice.text, "out 192M");
    assert.strictEqual(slice.width, 8);
    assert.strictEqual(visibleWidth(slice.text), slice.width);
  });

  it("keeps overlay segment widths consistent with visible width", () => {
    const text = "out 192M\t.msa/skill-tests/results-ha";
    const segments = extractSegments(text, 10, 13, 10, true);

    assert.strictEqual(segments.before, "out 192M");
    assert.strictEqual(segments.beforeWidth, 8);
    assert.strictEqual(visibleWidth(segments.before), segments.beforeWidth);

    const tabFits = extractSegments(text, 11, 13, 10, true);
    assert.strictEqual(tabFits.before, "out 192M\t");
    assert.strictEqual(tabFits.beforeWidth, 11);
    assert.strictEqual(visibleWidth(tabFits.before), tabFits.beforeWidth);
  });

  it("keeps tabs inside terminal control sequences byte-identical", () => {
    const controlSequences = [
      "\x1b]8;;https://example.test/a\tb\x07",
      "\x1b]0;window\ttitle\x1b\\",
      "\x1b_payload\tdata\x1b\\",
    ];

    for (const controlSequence of controlSequences) {
      assert.strictEqual(
        normalizeTerminalOutput(`${controlSequence}label\ttext`),
        `${controlSequence}label   text`,
      );
    }
  });
});

describe("tab width accounting", () => {
  it("keeps tab-containing overlays on one physical terminal row", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new CapturingVirtualTerminal(16, 3);
        const tui: TUI = new TuiMainScreen(terminal);
        tui.addChild(new FullViewportContent());
        tui.showOverlay(new TabStatusOverlay(), { width: 4, row: 1, col: 4 });
        tui.start();

        yield* Effect.gen(function* () {
          yield* Effect.promise(() => terminal.waitForRender());
          assert.deepStrictEqual(terminal.getViewport(), [
            "base 0          ",
            "base   X        ",
            "base 2          ",
          ]);
          assert.ok(!terminal.getOutput().includes("\t"));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
            }),
          ),
        );
      }),
    ));
});
