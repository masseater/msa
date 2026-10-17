import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";

describe("Input component", () => {
  it("submits value including backslash on Enter", () => {
    const input = new Input();
    let submitted: string | undefined;

    input.onSubmit = (value) => {
      submitted = value;
    };

    // Type hello, then backslash, then Enter
    input.handleInput("h");
    input.handleInput("e");
    input.handleInput("l");
    input.handleInput("l");
    input.handleInput("o");
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

    it("Ctrl+Y does nothing when kill ring is empty", () => {
      const input = new Input();

      input.setValue("test");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "test");
    });

    it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
      const input = new Input();

      // Create kill ring with multiple entries
      input.setValue("first");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "first"
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "second"
      input.handleInput("\x17");
      input.setValue("third");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "third"
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      // Ctrl+Y - yanks "third"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "third");

      // Alt+Y - cycles to "second"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      // Alt+Y - cycles to "first"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "first");

      // Alt+Y - cycles back to "third"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "third");
    });

    it("Alt+Y does nothing if not preceded by yank", () => {
      const input = new Input();

      input.setValue("test");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "test"
      input.handleInput("\x17");
      input.setValue("other");
      // Ctrl+E
      input.handleInput("\x05");

      // Type something to break the yank chain
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "otherx");

      // Alt+Y - should do nothing
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "otherx");
    });

    it("Alt+Y does nothing if kill ring has one entry", () => {
      const input = new Input();

      input.setValue("only");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "only"
      input.handleInput("\x17");

      // Ctrl+Y - yanks "only"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "only");

      // Alt+Y - should do nothing
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "only");
    });

    it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
      const input = new Input();

      input.setValue("one two three");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "three"
      input.handleInput("\x17");
      // Ctrl+W - deletes "two "
      input.handleInput("\x17");
      // Ctrl+W - deletes "one "
      input.handleInput("\x17");

      assert.strictEqual(input.getValue(), "");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "one two three");
    });

    it("non-delete actions break kill accumulation", () => {
      const input = new Input();

      input.setValue("foo bar baz");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "baz"
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      // Typing breaks accumulation
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "foo bar x");

      // Ctrl+W - deletes "x" (separate entry)
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "foo bar ");

      // Ctrl+Y - most recent is "x"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "foo bar x");

      // Alt+Y - cycle to "baz"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "foo bar baz");
    });

    it("non-yank actions break Alt+Y chain", () => {
      const input = new Input();

      input.setValue("first");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W
      input.handleInput("\x17");
      input.setValue("");

      // Ctrl+Y - yanks "second"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");

      // Breaks yank chain
      input.handleInput("x");
      assert.strictEqual(input.getValue(), "secondx");

      // Alt+Y - should do nothing
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "secondx");
    });

    it("kill ring rotation persists after cycling", () => {
      const input = new Input();

      input.setValue("first");
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "first"
      input.handleInput("\x17");
      input.setValue("second");
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "second"
      input.handleInput("\x17");
      input.setValue("third");
      // Ctrl+E
      input.handleInput("\x05");
      // deletes "third"
      input.handleInput("\x17");
      input.setValue("");

      // Ctrl+Y - yanks "third"
      input.handleInput("\x19");
      // Alt+Y - cycles to "second"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "second");

      // Break chain and start fresh
      input.handleInput("x");
      input.setValue("");

      // New yank should get "second" (now at end after rotation)
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "second");
    });

    it("backward deletions prepend, forward deletions append during accumulation", () => {
      const input = new Input();

      input.setValue("prefix|suffix");
      // Position cursor at "|"
      // Ctrl+A
      input.handleInput("\x01");
      // Move right 6
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+K - deletes "|suffix" (forward)
      input.handleInput("\x0b");
      assert.strictEqual(input.getValue(), "prefix");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "prefix|suffix");
    });

    it("Alt+D deletes word forward and saves to kill ring", () => {
      const input = new Input();

      input.setValue("hello world test");
      // Ctrl+A
      input.handleInput("\x01");

      // Alt+D - deletes "hello"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " world test");

      // Alt+D - deletes " world"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " test");

      // Yank should get accumulated text
      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello world test");
    });

    it("Alt+D preserves ASCII punctuation boundaries", () => {
      const input = new Input();

      input.setValue("foo.bar baz");
      // Ctrl+A
      input.handleInput("\x01");
      // Alt+D - deletes "foo"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), ".bar baz");
      // Alt+D - deletes "."
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "bar baz");
      // Alt+D - deletes "bar"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " baz");
    });

    it("Alt+D handles Unicode word boundaries", () => {
      const input = new Input();

      // "你好世界。你好，世界" segments as: 你好|世界|。|你好|，|世界
      input.setValue("你好世界。你好，世界");
      // Ctrl+A
      input.handleInput("\x01");
      // Alt+D - deletes "你好"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界。你好，世界");
      // Alt+D - deletes "世界"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "。你好，世界");
      // Alt+D - deletes "。"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "你好，世界");
      // Alt+D - deletes "你好"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "，世界");
      // Alt+D - deletes "，"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "世界");
      // Alt+D - deletes "世界"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), "");
    });

    it("handles yank in middle of text", () => {
      const input = new Input();

      input.setValue("word");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "word"
      input.handleInput("\x17");
      input.setValue("hello world");
      // Move to middle (after "hello ")
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+Y
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello wordworld");
    });

    it("handles yank-pop in middle of text", () => {
      const input = new Input();

      // Create two kill ring entries
      input.setValue("FIRST");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "FIRST"
      input.handleInput("\x17");
      input.setValue("SECOND");
      // Ctrl+E
      input.handleInput("\x05");
      // Ctrl+W - deletes "SECOND"
      input.handleInput("\x17");

      // Set up "hello world" and position cursor after "hello "
      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+Y - yanks "SECOND"
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello SECONDworld");

      // Alt+Y - replaces with "FIRST"
      input.handleInput("\x1by");
      assert.strictEqual(input.getValue(), "hello FIRSTworld");
    });
  });

  describe("Undo", () => {
    it("does nothing when undo stack is empty", () => {
      const input = new Input();

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("coalesces consecutive word characters into one undo unit", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput("w");
      input.handleInput("o");
      input.handleInput("r");
      input.handleInput("l");
      input.handleInput("d");
      assert.strictEqual(input.getValue(), "hello world");

      // Undo removes " world"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      // Undo removes "hello"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes spaces one at a time", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput(" ");
      assert.strictEqual(input.getValue(), "hello  ");

      // Ctrl+- (undo) - removes second " "
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo) - removes first " "
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");

      // Ctrl+- (undo) - removes "hello"
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes backspace", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      // Backspace
      input.handleInput("\x7f");
      assert.strictEqual(input.getValue(), "hell");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");
    });

    it("undoes forward delete", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      // Ctrl+A - go to start
      input.handleInput("\x01");
      // Right arrow
      input.handleInput("\x1b[C");
      // Delete key
      input.handleInput("\x1b[3~");
      assert.strictEqual(input.getValue(), "hllo");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello");
    });

    it("undoes Ctrl+W (delete word backward)", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput("w");
      input.handleInput("o");
      input.handleInput("r");
      input.handleInput("l");
      input.handleInput("d");
      assert.strictEqual(input.getValue(), "hello world");

      // Ctrl+W
      input.handleInput("\x17");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("undoes Ctrl+K (delete to line end)", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput("w");
      input.handleInput("o");
      input.handleInput("r");
      input.handleInput("l");
      input.handleInput("d");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+K
      input.handleInput("\x0b");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("undoes Ctrl+U (delete to line start)", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      input.handleInput("w");
      input.handleInput("o");
      input.handleInput("r");
      input.handleInput("l");
      input.handleInput("d");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

      // Ctrl+U
      input.handleInput("\x15");
      assert.strictEqual(input.getValue(), "world");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("undoes yank", () => {
      const input = new Input();

      input.handleInput("h");
      input.handleInput("e");
      input.handleInput("l");
      input.handleInput("l");
      input.handleInput("o");
      input.handleInput(" ");
      // Ctrl+W - delete "hello "
      input.handleInput("\x17");
      // Ctrl+Y - yank
      input.handleInput("\x19");
      assert.strictEqual(input.getValue(), "hello ");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });

    it("undoes paste atomically", () => {
      const input = new Input();

      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");
      for (let i = 0; i < 5; i++) input.handleInput("\x1b[C");

      // Simulate bracketed paste
      input.handleInput("\x1b[200~beep boop\x1b[201~");
      assert.strictEqual(input.getValue(), "hellobeep boop world");

      // Single undo should restore entire pre-paste state
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("undoes Alt+D (delete word forward)", () => {
      const input = new Input();

      input.setValue("hello world");
      // Ctrl+A
      input.handleInput("\x01");

      // Alt+D - deletes "hello"
      input.handleInput("\x1bd");
      assert.strictEqual(input.getValue(), " world");

      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "hello world");
    });

    it("cursor movement starts new undo unit", () => {
      const input = new Input();

      input.handleInput("a");
      input.handleInput("b");
      input.handleInput("c");
      // Ctrl+A - movement breaks coalescing
      input.handleInput("\x01");
      // Ctrl+E
      input.handleInput("\x05");
      input.handleInput("d");
      input.handleInput("e");
      assert.strictEqual(input.getValue(), "abcde");

      // Undo removes "de" (typed after movement)
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "abc");

      // Undo removes "abc"
      // Ctrl+- (undo)
      input.handleInput("\x1b[45;5u");
      assert.strictEqual(input.getValue(), "");
    });
  });
});
