import assert from "node:assert";
import { describe, it } from "node:test";

import Input from "../src/components/input.ts";

describe("Input component", () => {
  describe("Kill ring", () => {
    backwardDeletionsPrependForwardDeletions();
    altDPreservesASCIIPunctuation();
    altDHandlesUnicodeWord();
    handlesYankMiddleText();
    handlesYankPopMiddleText();
    altYCyclesThroughKill();
    altYDoesNothingIf();
    consecutiveCtrlWAccumulatesInto();
    nonDeleteActionsBreakKill();
    nonYankActionsBreakAlt();
    killRingRotationPersistsAfter();
  });
});

function backwardDeletionsPrependForwardDeletions(): void {
  it("backward deletions prepend, forward deletions append during accumulation", () => {
    const input = new Input();

    input.setValue("prefix|suffix");
    input.handleInput("\x01");
    for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

    input.handleInput("\x0b");
    assert.strictEqual(input.getValue(), "prefix");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "prefix|suffix");
  });
  it("Alt+D deletes word forward and saves to kill ring", () => {
    const input = new Input();

    input.setValue("hello world test");
    input.handleInput("\x01");

    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), " world test");

    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), " test");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "hello world test");
  });
}

function altDPreservesASCIIPunctuation(): void {
  it("Alt+D preserves ASCII punctuation boundaries", () => {
    const input = new Input();

    input.setValue("foo.bar baz");
    input.handleInput("\x01");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), ".bar baz");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "bar baz");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), " baz");
  });
}

function altDHandlesUnicodeWord(): void {
  it("Alt+D handles Unicode word boundaries", () => {
    const input = new Input();

    input.setValue("你好世界。你好，世界");
    input.handleInput("\x01");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "世界。你好，世界");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "。你好，世界");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "你好，世界");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "，世界");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "世界");
    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), "");
  });
}

function handlesYankMiddleText(): void {
  it("handles yank in middle of text", () => {
    const input = new Input();

    input.setValue("word");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("hello world");
    input.handleInput("\x01");
    for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "hello wordworld");
  });
}

function handlesYankPopMiddleText(): void {
  it("handles yank-pop in middle of text", () => {
    const input = new Input();

    input.setValue("FIRST");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("SECOND");
    input.handleInput("\x05");
    input.handleInput("\x17");

    input.setValue("hello world");
    input.handleInput("\x01");
    for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "hello SECONDworld");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "hello FIRSTworld");
  });
}

function altYCyclesThroughKill(): void {
  it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
    const input = new Input();

    input.setValue("first");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("second");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("third");
    input.handleInput("\x05");
    input.handleInput("\x17");

    assert.strictEqual(input.getValue(), "");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "third");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "second");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "first");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "third");
  });
}

function altYDoesNothingIf(): void {
  it("Alt+Y does nothing if not preceded by yank", () => {
    const input = new Input();

    input.setValue("test");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("other");
    input.handleInput("\x05");

    input.handleInput("x");
    assert.strictEqual(input.getValue(), "otherx");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "otherx");
  });
  it("Alt+Y does nothing if kill ring has one entry", () => {
    const input = new Input();

    input.setValue("only");
    input.handleInput("\x05");
    input.handleInput("\x17");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "only");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "only");
  });
}

function consecutiveCtrlWAccumulatesInto(): void {
  it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
    const input = new Input();

    input.setValue("one two three");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.handleInput("\x17");
    input.handleInput("\x17");

    assert.strictEqual(input.getValue(), "");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "one two three");
  });
}

function nonDeleteActionsBreakKill(): void {
  it("non-delete actions break kill accumulation", () => {
    const input = new Input();

    input.setValue("foo bar baz");
    input.handleInput("\x05");
    input.handleInput("\x17");
    assert.strictEqual(input.getValue(), "foo bar ");

    input.handleInput("x");
    assert.strictEqual(input.getValue(), "foo bar x");

    input.handleInput("\x17");
    assert.strictEqual(input.getValue(), "foo bar ");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "foo bar x");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "foo bar baz");
  });
}

function nonYankActionsBreakAlt(): void {
  it("non-yank actions break Alt+Y chain", () => {
    const input = new Input();

    input.setValue("first");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("second");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "second");

    input.handleInput("x");
    assert.strictEqual(input.getValue(), "secondx");

    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "secondx");
  });
}

function killRingRotationPersistsAfter(): void {
  it("kill ring rotation persists after cycling", () => {
    const input = new Input();

    input.setValue("first");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("second");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("third");
    input.handleInput("\x05");
    input.handleInput("\x17");
    input.setValue("");

    input.handleInput("\x19");
    input.handleInput("\x1by");
    assert.strictEqual(input.getValue(), "second");

    input.handleInput("x");
    input.setValue("");

    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "second");
  });
}
