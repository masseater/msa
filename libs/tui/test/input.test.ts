import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";
import { typeText } from "./editor-helpers.ts";

describe("Input component", () => {
  it("submits value including backslash on Enter", () => {
    const input = new Input();
    let submitted: string | undefined;

    input.onSubmit = (value) => {
      submitted = value;
    };

    // Type hello, then backslash, then Enter
    typeText(input, "hello");
    input.handleInput("\\");
    input.handleInput("\r");

    // Input is single-line, no backslash+Enter workaround
    assert.strictEqual(submitted, "hello\\");
  });

  it("inserts backslash as regular character", () => {
    const input = new Input();

    input.handleInput("\\");
    input.handleInput("x");

    assert.strictEqual(input.getValue(), "\\x");
  });

  it("continues typing after a value set in code, even one longer than before", () => {
    const input = new Input();

    typeText(input, "ab");
    input.setValue("the client speaks v3");
    typeText(input, " and v4");

    assert.strictEqual(input.getValue(), "the client speaks v3 and v4");
  });
});

describe("Input component", () => {
  describe("render", () => {
    it("supports a custom prompt and styled placeholder", () => {
      const input = new Input({
        prompt: "",
        placeholder: "Find transcript",
        placeholderStyle: (text) => `\x1b[2m${text}\x1b[22m`,
      });
      input.focused = true;

      const [empty] = input.render(20);
      assert.ok(empty?.includes("\x1b[2m"));
      assert.strictEqual(stripTerminalSequences(empty ?? "").trimEnd(), "Find transcript");

      input.handleInput("n");
      const [populated] = input.render(20);
      assert.strictEqual(stripTerminalSequences(populated ?? "").trimEnd(), "n");
    });
  });
});

describe("Input component", () => {
  describe("render", () => {
    it("does not overflow with wide CJK and fullwidth text", () => {
      const width = 93;
      const cases = [
        "가나다라마바사아자차카타파하 한글 텍스트가 터미널 너비를 초과하면 크래시가 발생합니다 이것은 재현용 테스트입니다",
        "これはテスト文章です。日本語のテキストが正しく表示されるかどうかを確認するためのサンプルテキストです。あいうえお",
        "这是一段测试文本，用于验证中文字符在终端中的显示宽度是否被正确计算，如果不正确就会导致用户界面崩溃的问题",
        "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍ",
      ];
      const cursorPositions = [
        { label: "start", move: (_input: Input) => {} },
        {
          label: "middle",
          move: (input: Input) => {
            for (let i = 0; i < 10; i++) input.handleInput("\x1b[C");
          },
        },
        { label: "end", move: (input: Input) => input.handleInput("\x05") },
      ];

      for (const text of cases) {
        for (const { label, move } of cursorPositions) {
          const input = new Input();
          input.setValue(text);
          input.focused = true;
          move(input);

          const [line] = input.render(width);
          assert.ok(line);
          assert.ok(
            visibleWidth(line) <= width,
            `rendered line overflowed for ${text} at ${label}`,
          );
        }
      }
    });
  });
});

describe("Input component", () => {
  describe("render", () => {
    it("keeps the cursor visible when horizontally scrolling wide text", () => {
      const input = new Input();
      const width = 20;
      const text = "가나다라마바사아자차카타파하";
      input.setValue(text);
      input.focused = true;
      input.handleInput("\x01");
      for (let i = 0; i < 5; i++) input.handleInput("\x1b[C");

      const [line] = input.render(width);
      assert.ok(line);
      assert.ok(visibleWidth(line) <= width);
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Ctrl+W saves deleted text to kill ring and Ctrl+Y yanks it", () => {
      const input = new Input();

      input.setValue("foo bar baz");
      // Move cursor to end
      // Ctrl+E
      input.handleInput("\x05");

      // Ctrl+W - deletes "baz"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      // Move to beginning and yank
      // Ctrl+A
      input.handleInput("\x01");
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "bazfoo bar ");
    });

    it("Ctrl+W preserves ASCII punctuation boundaries", () => {
      const input = new Input();

      input.setValue("foo.bar");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "bar"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo.");

      input.setValue("foo:bar");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "bar"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo:");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Ctrl+W handles Unicode word boundaries", () => {
      const input = new Input();

      // "你好世界。你好，世界" segments as: 你好|世界|。|你好|，|世界
      input.setValue("你好世界。你好，世界");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "世界"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "你好世界。你好，");
      // Ctrl+W - deletes "，"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "你好世界。你好");
      // Ctrl+W - deletes "你好"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "你好世界。");
      // Ctrl+W - deletes "。"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "你好世界");
      // Ctrl+W - deletes "世界"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "你好");
      // Ctrl+W - deletes "你好"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Ctrl+U saves deleted text to kill ring", () => {
      const input = new Input();

      input.setValue("hello world");
      // Move cursor to after "hello "
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+U - deletes "hello "
      input.handleInput("\x15");
      assert.strictEqual(input.getValue(), "world");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("Ctrl+K saves deleted text to kill ring", () => {
      const input = new Input();

      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");
      // Ctrl+K - deletes "hello world"
      input.handleInput("\x0b");

      assert.strictEqual(input.getValue(), "");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello world");
    });
  });
});

describe("Input component", () => {
  describe("Kill ring", () => {
    it("Ctrl+Y does nothing when kill ring is empty", () => {
      const input = new Input();

      input.setValue("test");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "test");
    });
  });
});
