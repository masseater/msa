import assert from "node:assert";
import { describe, it } from "node:test";

import SelectList from "../src/components/select-list.ts";
import utils from "../src/utils.ts";

const { visibleWidth } = utils;

const testTheme = {
  description: (text: string) => text,
  noMatch: (text: string) => text,
  scrollInfo: (text: string) => text,
  selectedPrefix: (text: string) => text,
  selectedText: (text: string) => text,
};

const visibleIndexOf = (line: string, text: string): number => {
  const index = line.indexOf(text);
  assert.notEqual(index, -1);
  return visibleWidth(line.slice(0, index));
};

describe("SelectList", () => {
  it("normalizes multiline descriptions to single line", () => {
    const items = [
      {
        description: "Line one\nLine two\nLine three",
        label: "test",
        value: "test",
      },
    ];

    const list = new SelectList(items, 5, testTheme);
    const rendered = list.render(100);

    const [first] = rendered;
    assert.ok(first !== undefined);
    assert.ok(!first.includes("\n"));
    assert.ok(first.includes("Line one Line two Line three"));
  });

  it("keeps descriptions aligned when the primary text is truncated", () => {
    const items = [
      { description: "short description", label: "short", value: "short" },
      {
        description: "long description",
        label: "very-long-command-name-that-needs-truncation",
        value: "very-long-command-name-that-needs-truncation",
      },
    ];

    const list = new SelectList(items, 5, testTheme);
    const [first, second] = list.render(80);
    assert.ok(first !== undefined && second !== undefined);

    assert.equal(
      visibleIndexOf(first, "short description"),
      visibleIndexOf(second, "long description"),
    );
  });
});

describe("SelectList", () => {
  it("uses the configured minimum primary column width", () => {
    const items = [
      { description: "first", label: "a", value: "a" },
      { description: "second", label: "bb", value: "bb" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      maxPrimaryColumnWidth: 20,
      minPrimaryColumnWidth: 12,
    });
    const rendered = list.render(80);

    assert.equal(rendered[0]?.indexOf("first"), 14);
    assert.equal(rendered[1]?.indexOf("second"), 14);
  });

  it("uses the configured maximum primary column width", () => {
    const items = [
      {
        description: "first",
        label: "very-long-command-name-that-needs-truncation",
        value: "very-long-command-name-that-needs-truncation",
      },
      { description: "second", label: "short", value: "short" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      maxPrimaryColumnWidth: 20,
      minPrimaryColumnWidth: 12,
    });
    const [first, second] = list.render(80);
    assert.ok(first !== undefined && second !== undefined);

    assert.equal(visibleIndexOf(first, "first"), 22);
    assert.equal(visibleIndexOf(second, "second"), 22);
  });
});

describe("SelectList", () => {
  it("allows overriding primary truncation while preserving description alignment", () => {
    const items = [
      {
        description: "first",
        label: "very-long-command-name-that-needs-truncation",
        value: "very-long-command-name-that-needs-truncation",
      },
      { description: "second", label: "short", value: "short" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      maxPrimaryColumnWidth: 12,
      minPrimaryColumnWidth: 12,
      truncatePrimary: ({ text, maxWidth }) => {
        if (text.length <= maxWidth) {
          return text;
        }

        return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
      },
    });
    const [first, second] = list.render(80);
    assert.ok(first !== undefined && second !== undefined);

    assert.ok(first.includes("…"));
    assert.equal(visibleIndexOf(first, "first"), visibleIndexOf(second, "second"));
  });
});
