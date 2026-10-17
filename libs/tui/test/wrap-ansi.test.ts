import assert from "node:assert";
import { describe, it } from "node:test";

import { visibleWidth, wrapTextWithAnsi } from "../src/utils.ts";

describe("wrapTextWithAnsi", () => {
  describe("underline styling", () => {
    it("should not apply underline style before the styled text", () => {
      const underlineOn = "\x1b[4m";
      const underlineOff = "\x1b[24m";
      const url = "https://example.com/very/long/path/that/will/wrap";
      const text = `read this thread ${underlineOn}${url}${underlineOff}`;

      const wrapped = wrapTextWithAnsi(text, 40);

      // First line should NOT contain underline code - it's just "read this thread"
      assert.strictEqual(wrapped[0], "read this thread");

      // Second line should start with underline, have URL content
      assert.strictEqual(wrapped[1]?.startsWith(underlineOn), true);
      assert.ok(wrapped[1]?.includes("https://"));
    });

    it("should not have whitespace before underline reset code", () => {
      const underlineOn = "\x1b[4m";
      const underlineOff = "\x1b[24m";
      const textWithUnderlinedTrailingSpace = `${underlineOn}underlined text here ${underlineOff}more`;

      const wrapped = wrapTextWithAnsi(textWithUnderlinedTrailingSpace, 18);

      const [first] = wrapped;
      assert.ok(first !== undefined);
      assert.ok(!first.includes(` ${underlineOff}`));
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("underline styling", () => {
    it("should not bleed underline to padding - each line should end with reset for underline only", () => {
      const underlineOn = "\x1b[4m";
      const underlineOff = "\x1b[24m";
      const url = "https://example.com/very/long/path/that/will/definitely/wrap";
      const text = `prefix ${underlineOn}${url}${underlineOff} suffix`;

      const wrapped = wrapTextWithAnsi(text, 30);

      // Middle lines (with underlined content) should end with underline-off, not full reset
      // Line 1 and 2 contain underlined URL parts
      for (let i = 1; i < wrapped.length - 1; i++) {
        const line = wrapped[i];
        assert.ok(line !== undefined);
        if (line.includes(underlineOn)) {
          // Should end with underline off, NOT full reset
          assert.strictEqual(line.endsWith(underlineOff), true);
          assert.strictEqual(line.endsWith("\x1b[0m"), false);
        }
      }
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("background color preservation", () => {
    it("should preserve background color across wrapped lines without full reset", () => {
      const bgBlue = "\x1b[44m";
      const reset = "\x1b[0m";
      const text = `${bgBlue}hello world this is blue background text${reset}`;

      const wrapped = wrapTextWithAnsi(text, 15);

      // Each line should have background color
      for (const line of wrapped) {
        assert.ok(line.includes(bgBlue));
      }

      // Middle lines should NOT end with full reset (kills background for padding)
      for (let i = 0; i < wrapped.length - 1; i++) {
        assert.strictEqual(wrapped[i]?.endsWith("\x1b[0m"), false);
      }
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("background color preservation", () => {
    it("should reset underline but preserve background when wrapping underlined text inside background", () => {
      const underlineOn = "\x1b[4m";
      const underlineOff = "\x1b[24m";
      const reset = "\x1b[0m";

      const text = `\x1b[41mprefix ${underlineOn}UNDERLINED_CONTENT_THAT_WRAPS${underlineOff} suffix${reset}`;

      const wrapped = wrapTextWithAnsi(text, 20);

      // All lines should have background color 41 (either as \x1b[41m or combined like \x1b[4;41m)
      for (const line of wrapped) {
        const hasBgColor = line.includes("[41m") || line.includes(";41m") || line.includes("[41;");
        assert.ok(hasBgColor);
      }

      // Lines with underlined content should use underline-off at end, not full reset
      for (let i = 0; i < wrapped.length - 1; i++) {
        const line = wrapped[i];
        assert.ok(line !== undefined);
        // If this line has underline on, it should end with underline off (not full reset)
        if (
          (line.includes("[4m") || line.includes("[4;") || line.includes(";4m")) &&
          !line.includes(underlineOff)
        ) {
          assert.strictEqual(line.endsWith(underlineOff), true);
          assert.strictEqual(line.endsWith("\x1b[0m"), false);
        }
      }
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("basic wrapping", () => {
    it("should handle LF, CRLF, and CR line endings", () => {
      assert.deepStrictEqual(wrapTextWithAnsi("first\nsecond\r\nthird\rfourth", 80), [
        "first",
        "second",
        "third",
        "fourth",
      ]);
    });

    it("should preserve ANSI state across CRLF and CR line endings", () => {
      const red = "\x1b[31m";
      const reset = "\x1b[0m";

      assert.deepStrictEqual(wrapTextWithAnsi(`${red}first\r\nsecond\rthird${reset}`, 80), [
        `${red}first`,
        `${red}second`,
        `${red}third${reset}`,
      ]);
    });

    it("should wrap plain text correctly", () => {
      const text = "hello world this is a test";
      const wrapped = wrapTextWithAnsi(text, 10);

      assert.ok(wrapped.length > 1);
      for (const line of wrapped) {
        assert.ok(visibleWidth(line) <= 10);
      }
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("basic wrapping", () => {
    it("should break CJK runs at grapheme boundaries after Latin text", () => {
      const text = "This is an example 中文汉字测试段落内容中文汉字测试段落内容.";
      const wrapped = wrapTextWithAnsi(text, 40);

      assert.deepStrictEqual(wrapped, [
        "This is an example 中文汉字测试段落内容",
        "中文汉字测试段落内容.",
      ]);
      for (const line of wrapped) {
        assert.ok(visibleWidth(line) <= 40);
      }
    });

    it("should preserve color codes when wrapping CJK runs", () => {
      const red = "\x1b[31m";
      const reset = "\x1b[0m";
      const text = `${red}This is an example 中文汉字测试段落内容中文汉字测试段落内容.${reset}`;
      const wrapped = wrapTextWithAnsi(text, 40);

      assert.strictEqual(wrapped.length, 2);
      assert.strictEqual(wrapped[0], `${red}This is an example 中文汉字测试段落内容`);
      assert.strictEqual(wrapped[1], `${red}中文汉字测试段落内容.${reset}`);
      for (const line of wrapped) {
        assert.ok(visibleWidth(line) <= 40);
      }
    });

    it("should ignore OSC 133 semantic markers in visible width", () => {
      const text = "\x1b]133;A\x07hello\x1b]133;B\x07";
      assert.strictEqual(visibleWidth(text), 5);
    });

    it("should ignore OSC sequences terminated with ST in visible width", () => {
      const text = "\x1b]133;A\x1b\\hello\x1b]133;B\x1b\\";
      assert.strictEqual(visibleWidth(text), 5);
    });

    it("should treat isolated regional indicators as width 2", () => {
      assert.strictEqual(visibleWidth("🇨"), 2);
      assert.strictEqual(visibleWidth("🇨🇳"), 2);
    });
  });
});

describe("wrapTextWithAnsi", () => {
  describe("basic wrapping", () => {
    it("should truncate trailing whitespace that exceeds width", () => {
      const [first] = wrapTextWithAnsi("  ", 1);
      assert.ok(first !== undefined);
      assert.ok(visibleWidth(first) <= 1);
    });

    it("should preserve color codes across wraps", () => {
      const red = "\x1b[31m";
      const reset = "\x1b[0m";
      const text = `${red}hello world this is red${reset}`;

      const wrapped = wrapTextWithAnsi(text, 10);

      // Each continuation line should start with red code
      for (let i = 1; i < wrapped.length; i++) {
        assert.strictEqual(wrapped[i]?.startsWith(red), true);
      }

      // Middle lines should not end with full reset
      for (let i = 0; i < wrapped.length - 1; i++) {
        assert.strictEqual(wrapped[i]?.endsWith("\x1b[0m"), false);
      }
    });
  });
});
