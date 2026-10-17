import assert from "node:assert";
import { describe, it } from "node:test";

import { HStack } from "../src/components/h-stack.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { encodeKitty, registerKittyImageMetadata } from "../src/terminal-image.ts";
import { visibleLines } from "./layout-helpers.ts";

describe("viewport layout", () => {
  it("allocates vertical grow space deterministically", () => {
    const frame = renderLayoutFrame(
      new VStack([
        { component: new Text("top", 0, 0), basis: 1, shrink: 0 },
        { component: new Text("body", 0, 0), basis: 0, grow: 1 },
      ]),
      10,
      4,
      () => {},
    );

    assert.deepStrictEqual(
      frame.root.children.map((child) => child.rect.height),
      [1, 3],
    );
    assert.deepStrictEqual(visibleLines(frame.lines), ["top", "body", "", ""]);
  });

  it("does not render fixed-basis scroll content during stack measurement", () => {
    let renderCount = 0;
    const transcript = new ScrollView({
      render: () => {
        renderCount += 1;
        return ["one", "two", "three"];
      },
      invalidate: () => {},
    });
    const root = new VStack([
      { component: transcript, basis: 0, grow: 1 },
      { component: new Text("dock", 0, 0), basis: "auto" },
    ]);
    renderLayoutFrame(root, 10, 3, () => {});
    assert.strictEqual(renderCount, 1);
  });
});

describe("viewport layout", () => {
  it("paints only clipped rows from very large scroll content", () => {
    const lineCount = 1_000_000_000;
    const lines: string[] = [];
    lines.length = lineCount;
    lines[lineCount - 4] = "before";
    lines[lineCount - 3] = "visible 1";
    lines[lineCount - 2] = "visible 2";
    lines[lineCount - 1] = "visible 3";
    const transcript = new ScrollView(
      {
        render: () => lines,
        invalidate: () => {},
      },
      { follow: "end" },
    );

    const frame = renderLayoutFrame(transcript, 10, 3, () => {});
    assert.deepStrictEqual(visibleLines(frame.lines), ["visible 1", "visible 2", "visible 3"]);
  });

  it("shrinks entries to their minimum sizes", () => {
    const frame = renderLayoutFrame(
      new VStack([
        { component: new Text("a1\na2\na3", 0, 0), shrink: 1, minSize: 1 },
        { component: new Text("b1\nb2\nb3", 0, 0), shrink: 0 },
      ]),
      10,
      4,
      () => {},
    );

    assert.deepStrictEqual(
      frame.root.children.map((child) => child.rect.height),
      [1, 3],
    );
    assert.deepStrictEqual(visibleLines(frame.lines), ["a1", "b1", "b2", "b3"]);
  });
});

describe("viewport layout", () => {
  it("includes nested minimum sizes in intrinsic stack measurement", () => {
    const dock = new VStack([
      new Text("top1\ntop2\ntop3", 0, 0),
      { component: new Text("selector", 0, 0), minSize: 3 },
      new Text("below", 0, 0),
      { component: new Text("footer", 0, 0), minSize: 1 },
    ]);
    const frame = renderLayoutFrame(
      new VStack([
        { component: new Text("body", 0, 0), basis: 0, grow: 1, minSize: 1 },
        { component: dock, basis: "auto", minSize: 1 },
      ]),
      10,
      9,
      () => {},
    );

    assert.deepStrictEqual(visibleLines(frame.lines), [
      "body",
      "top1",
      "top2",
      "top3",
      "selector",
      "",
      "",
      "below",
      "footer",
    ]);
  });
});

describe("viewport layout", () => {
  it("omits gaps around invisible entries", () => {
    const stack = new VStack(
      [
        new Text("one", 0, 0),
        { component: new Text("hidden", 0, 0), visible: () => false },
        new Text("two", 0, 0),
      ],
      { gap: 1 },
    );
    assert.deepStrictEqual(
      stack.render(10).map((line) => line.trimEnd()),
      ["one", "", "two"],
    );
  });

  it("crops Kitty images at a scroll view's lower boundary", () => {
    const imageId = 124;
    const imageLine = encodeKitty("AAAA", { columns: 2, rows: 3, imageId, moveCursor: false });
    registerKittyImageMetadata({ imageId, columns: 2, rows: 3, widthPx: 100, heightPx: 100 });
    const transcript = new ScrollView({
      render: () => ["one", "two", imageLine, "", ""],
      invalidate: () => {},
    });
    const frame = renderLayoutFrame(
      new VStack([{ component: transcript, basis: 0, grow: 1 }, new Text("dock", 0, 0)]),
      20,
      4,
      () => {},
    );

    assert.ok(frame.lines[2]?.includes("y=0,h=34,r=1"));
  });
});

describe("viewport layout", () => {
  it("composes horizontal children at allocated widths", () => {
    const frame = renderLayoutFrame(
      new HStack([
        { component: new Text("left", 0, 0), basis: 6, shrink: 0 },
        { component: new Text("right", 0, 0), basis: 6, shrink: 0 },
      ]),
      12,
      1,
      () => {},
    );
    assert.deepStrictEqual(visibleLines(frame.lines), ["left  right"]);
  });

  it("does not paint zero-width horizontal children", () => {
    const frame = renderLayoutFrame(
      new HStack([
        { component: new Text("hidden", 0, 0), basis: 0, shrink: 0 },
        { component: new Text("shown", 0, 0), basis: 0, grow: 1 },
      ]),
      5,
      1,
      () => {},
    );
    assert.deepStrictEqual(visibleLines(frame.lines), ["shown"]);
  });
});

describe("viewport layout", () => {
  it("tracks follow-end state and returns unused scroll delta", () => {
    const scrollView = new ScrollView(new Text("1\n2\n3\n4\n5\n6", 0, 0), {
      follow: "end",
      primary: true,
    });
    renderLayoutFrame(scrollView, 10, 3, () => {});
    assert.strictEqual(scrollView.scrollTop, 3);
    assert.strictEqual(scrollView.isFollowingEnd, true);

    assert.strictEqual(scrollView.scrollBy(-2), 0);
    assert.strictEqual(scrollView.scrollTop, 1);
    assert.strictEqual(scrollView.isFollowingEnd, false);
    assert.strictEqual(scrollView.scrollBy(-3), -2);
    assert.strictEqual(scrollView.scrollTop, 0);
    assert.strictEqual(scrollView.scrollBy(10), 7);
    assert.strictEqual(scrollView.scrollTop, 3);
    assert.strictEqual(scrollView.isFollowingEnd, true);
  });
});
