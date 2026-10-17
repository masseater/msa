import assert from "node:assert";
import { describe, it } from "node:test";

import {
  escapeSequences,
  stripHyperlinkSequences,
  stripStyleSequences,
} from "../src/ansi-sequences.ts";
import { wrapTextWithAnsi } from "../src/utils.ts";

describe("wrapTextWithAnsi with OSC 8 hyperlinks", () => {
  it("re-emits OSC 8 open at the start of continuation lines", () => {
    const url = "https://example.com";
    const input = `\x1b]8;;${url}\x1b\\0123456789\x1b]8;;\x1b\\`;
    const lines = wrapTextWithAnsi(input, 6);

    for (const line of lines) {
      const stripped = stripStyleSequences(stripHyperlinkSequences(line));
      if (stripped.trim().length > 0) {
        assert.ok(
          line.startsWith(`\x1b]8;;${url}\x1b\\`) || line.includes(`\x1b]8;;${url}\x1b\\`),
          `Line "${line}" has visible text but no OSC 8 re-open`,
        );
      }
    }
  });

  it("closes OSC 8 before each line break", () => {
    const url = "https://example.com";
    const input = `\x1b]8;;${url}\x1b\\0123456789\x1b]8;;\x1b\\`;
    const lines = wrapTextWithAnsi(input, 6);

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      assert.ok(line !== undefined);
      if (line.includes(`\x1b]8;;${url}\x1b\\`)) {
        assert.ok(
          line.endsWith("\x1b]8;;\x1b\\"),
          `Non-final line "${line}" is inside a hyperlink but does not close it`,
        );
      }
    }
  });
});

describe("wrapTextWithAnsi with OSC 8 hyperlinks", () => {
  it("preserves BEL terminators when wrapping OAuth-style hyperlinks", () => {
    const url = `https://example.com/oauth/${"a".repeat(32)}`;
    const input = `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;
    const lines = wrapTextWithAnsi(input, 20);

    assert.ok(lines.length > 1);
    for (const line of lines) {
      assert.ok(
        line.includes(`\x1b]8;;${url}\x07`),
        `Line "${line}" does not reopen the hyperlink with BEL`,
      );
      assert.ok(
        !line.includes(`\x1b]8;;${url}\x1b\\`),
        `Line "${line}" reopens the hyperlink with ST`,
      );
    }
    for (const line of lines.slice(0, -1)) {
      assert.ok(
        line.endsWith("\x1b]8;;\x07"),
        `Line "${line}" does not close the hyperlink with BEL`,
      );
    }
  });

  it("does not emit OSC 8 sequences on lines that are outside the hyperlink", () => {
    const url = "https://example.com";
    const input = `before \x1b]8;;${url}\x1b\\link\x1b]8;;\x1b\\ after`;
    const lines = wrapTextWithAnsi(input, 80);

    assert.strictEqual(lines.length, 1);
    const [line] = lines;
    assert.ok(line !== undefined);
    const hyperlinks = escapeSequences(line).filter((sequence) => sequence.kind === "osc");
    const openCount = hyperlinks.filter((sequence) => sequence.body.startsWith("8;;https:")).length;
    const closeCount = hyperlinks.filter((sequence) => sequence.body === "8;;").length;
    assert.strictEqual(openCount, 1);
    assert.strictEqual(closeCount, 1);
  });
});
