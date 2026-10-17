import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { HStack } from "../src/components/h-stack.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { stripTerminalSequences } from "../src/utils.ts";
import { visibleLines } from "./layout-helpers.ts";

describe("viewport layout", () => {
  viewportLayoutCases1();
});

function viewportLayoutCases1(): void {
  it("renders a proportional glyph scrollbar with an expanded active thumb", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sourceLines = [
          "abcd界",
          "abcde2",
          "abcde3",
          "abcde4",
          "abcde5",
          "abcde6",
          "abcde7",
          "abcde8",
        ];
        const contentBackground = "\x1b[42m";
        const trackColor = "\x1b[38;5;2m";
        const thumbColor = "\x1b[38;5;1m";
        const scrollbarTrackStyle = (text: string) => `${trackColor}${text}\x1b[39m`;
        const scrollbarThumbStyle = (text: string) => `${thumbColor}${text}\x1b[39m`;
        const content = new Text(
          sourceLines.join("\n"),
          0,
          0,
          (text) => `${contentBackground}${text}\x1b[49m`,
        );
        const scrollView = new ScrollView(content, {
          scrollbar: "auto",
          scrollbarTrackStyle,
          scrollbarThumbStyle,
          scrollbarHideDelayMs: 10,
        });
        const render = () => renderLayoutFrame(scrollView, 6, 4, () => {}).lines;
        const visible = (lines: string[]) => lines.map(stripTerminalSequences);

        let lines = render();
        assert.deepStrictEqual(visible(lines), sourceLines.slice(0, 4));

        scrollView.scrollBy(2);
        lines = render();
        assert.deepStrictEqual(visible(lines), ["abcde│", "abcde┃", "abcde┃", "abcde│"]);
        assert.deepStrictEqual(
          lines.map((line) => line.includes(trackColor)),
          [true, false, false, true],
        );
        assert.deepStrictEqual(
          lines.map((line) => line.includes(thumbColor)),
          [false, true, true, false],
        );

        scrollView.setScrollbarActive(true);
        lines = render();
        assert.deepStrictEqual(visible(lines), ["abcde│", "abcde█", "abcde█", "abcde│"]);
        assert.deepStrictEqual(
          lines.map((line) => line.includes(thumbColor)),
          [false, true, true, false],
        );
        assert.ok(lines[1]!.lastIndexOf(contentBackground) < lines[1]!.lastIndexOf(thumbColor));

        scrollView.setScrollbarActive(false);
        yield* Effect.sleep(30);
        lines = render();
        assert.deepStrictEqual(visible(lines), sourceLines.slice(2, 6));

        scrollView.scrollToEnd();
        lines = render();
        assert.deepStrictEqual(visible(lines), ["abcde│", "abcde│", "abcde┃", "abcde┃"]);

        scrollView.scrollToStart();
        lines = render();
        assert.strictEqual(visible(lines)[0], "abcd ┃");

        const followedContent = new Text(sourceLines.join("\n"), 0, 0);
        const followed = new ScrollView(followedContent, {
          follow: "end",
          scrollbar: "auto",
          scrollbarTrackStyle,
          scrollbarThumbStyle,
        });
        renderLayoutFrame(followed, 6, 4, () => {});
        assert.strictEqual(followed.scrollTop, 4);
        followedContent.setText(`${sourceLines.join("\n")}\nabcde9`);
        const growthFrame = renderLayoutFrame(followed, 6, 4, () => {});
        assert.strictEqual(followed.scrollTop, 5);
        assert.ok(growthFrame.lines.every((line) => !/[│┃]/u.test(stripTerminalSequences(line))));

        const fittingContent = new Text("1\n2", 0, 0);
        const automatic = new ScrollView(fittingContent, {
          scrollbar: "auto",
          scrollbarThumbStyle,
        });
        renderLayoutFrame(automatic, 6, 4, () => {});
        automatic.scrollBy(1);
        assert.ok(
          renderLayoutFrame(automatic, 6, 4, () => {}).lines.every(
            (line) => !/[│┃]/u.test(stripTerminalSequences(line)),
          ),
        );

        const alwaysFitting = new ScrollView(fittingContent, {
          scrollbar: "always",
          scrollbarThumbStyle,
        });
        const alwaysFittingFrame = renderLayoutFrame(alwaysFitting, 6, 4, () => {});
        assert.strictEqual(alwaysFittingFrame.root.children[0]?.rect.width, 5);
        assert.ok(visible(alwaysFittingFrame.lines).every((line) => line.endsWith("┃")));

        const alwaysOverflowing = new ScrollView(content, {
          scrollbar: "always",
          scrollbarTrackStyle,
          scrollbarThumbStyle,
        });
        const alwaysOverflowingFrame = renderLayoutFrame(alwaysOverflowing, 6, 4, () => {});
        assert.strictEqual(alwaysOverflowingFrame.root.children[0]?.rect.width, 5);
        assert.strictEqual(
          visible(alwaysOverflowingFrame.lines).filter((line) => line.endsWith("┃")).length,
          2,
        );
        assert.strictEqual(
          visible(alwaysOverflowingFrame.lines).filter((line) => line.endsWith("│")).length,
          2,
        );
        for (const line of alwaysOverflowingFrame.lines) {
          const scrollbarStyleIndex = Math.max(
            line.lastIndexOf(trackColor),
            line.lastIndexOf(thumbColor),
          );
          const reservedColumnResetIndex = line.lastIndexOf(
            "\x1b[0m\x1b]8;;\x07",
            scrollbarStyleIndex,
          );
          assert.ok(reservedColumnResetIndex > line.lastIndexOf(contentBackground));
        }

        const thumbHeightFor = (contentHeight: number) => {
          const sized = new ScrollView(
            new Text(Array.from({ length: contentHeight }, () => "x").join("\n"), 0, 0),
            {
              scrollbar: "auto",
              scrollbarThumbStyle,
            },
          );
          renderLayoutFrame(sized, 6, 20, () => {});
          sized.scrollBy(1);
          return renderLayoutFrame(sized, 6, 20, () => {}).lines.filter((line) =>
            stripTerminalSequences(line).endsWith("┃"),
          ).length;
        };
        assert.strictEqual(thumbHeightFor(21), 19);
        assert.strictEqual(thumbHeightFor(40), 10);
        assert.strictEqual(thumbHeightFor(100), 4);
        assert.strictEqual(thumbHeightFor(400), 2);
      }),
    ));
}

describe("viewport layout", () => {
  it("preserves only the underlying background beneath overlay scrollbar glyphs", () => {
    const background = "\x1b[42m";
    const borderForeground = "\x1b[31m";
    const content = {
      render: (width: number) =>
        Array.from(
          { length: 8 },
          () => `${background}${"x".repeat(width - 1)}${borderForeground}│\x1b[39m\x1b[49m`,
        ),
      invalidate: () => {},
    };
    const scrollView = new ScrollView(content, {
      scrollbar: "auto",
      scrollbarTrackStyle: (text) => text,
      scrollbarThumbStyle: (text) => text,
    });
    renderLayoutFrame(scrollView, 6, 4, () => {});
    scrollView.scrollBy(1);
    const frame = renderLayoutFrame(scrollView, 6, 4, () => {});

    assert.deepStrictEqual(frame.lines.map(stripTerminalSequences), [
      "xxxxx│",
      "xxxxx┃",
      "xxxxx┃",
      "xxxxx│",
    ]);
    for (const line of frame.lines) {
      assert.ok(line.includes(background));
      assert.ok(!line.includes(borderForeground));
      assert.ok(line.includes(`\x1b[0m\x1b]8;;\x07${background}`));
    }
  });
});

describe("viewport layout", () => {
  it("updates reserved scrollbar layout at runtime", () => {
    const scrollView = new ScrollView(new Text("123456", 0, 0), { scrollbar: "always" });
    const render = () =>
      renderLayoutFrame(new HStack([scrollView], { align: "start" }), 6, 2, () => {});
    const always = render();
    assert.deepStrictEqual(visibleLines(always.lines), ["12345┃", "6    ┃"]);
    assert.strictEqual(always.root.children[0]?.rect.width, 6);
    assert.strictEqual(always.root.children[0]?.children[0]?.rect.width, 5);

    scrollView.setScrollbar("hidden");
    assert.strictEqual(render().root.children[0]?.children[0]?.rect.width, 6);
    assert.strictEqual(scrollView.isScrollbarVisible, false);
  });

  it("measures nested scroll content from constrained child geometry", () => {
    const inner = new ScrollView(new Text("1\n2\n3\n4\n5\n6", 0, 0));
    const outer = new ScrollView(
      new VStack([{ component: inner, basis: 2 }, new Text("tail", 0, 0)]),
    );
    renderLayoutFrame(outer, 10, 2, () => {});

    assert.strictEqual(inner.viewportHeight, 2);
    assert.strictEqual(outer.scrollBy(10), 9);
    assert.strictEqual(outer.scrollTop, 1);
  });

  it("rebuilds geometry after content changes", () => {
    const text = new Text("one", 0, 0);
    const root = new VStack([text]);
    const first = renderLayoutFrame(root, 10, 4, () => {});
    text.setText("one\ntwo\nthree");
    const second = renderLayoutFrame(root, 10, 4, () => {});

    assert.strictEqual(first.root.children[0]?.lines?.length, 1);
    assert.strictEqual(second.root.children[0]?.lines?.length, 3);
  });
});
