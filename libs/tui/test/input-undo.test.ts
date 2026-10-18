import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { typeText } from "./editor-helpers.ts";

describe("Input component", () => {
  describe("Undo", () => {
    undoesForwardDelete();
    undoesCtrlWDeleteWord();
    undoesCtrlKDeleteLine();
    undoesCtrlUDeleteLine();
    undoesYank();
    undoesAltDDeleteWord();
    doesNothingUndoStackEmpty();
    undoesSpacesOneTime();
  });
});

function undoesForwardDelete(): void {
  it("undoes forward delete", () => {
    const input = new Input();

    typeText(input, "hello");
    input.handleInput("\x01");
    input.handleInput("\x1b[C");
    input.handleInput("\x1b[3~");
    assert.strictEqual(input.getValue(), "hllo");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello");
  });
}

function undoesCtrlWDeleteWord(): void {
  it("undoes Ctrl+W (delete word backward)", () => {
    const input = new Input();

    typeText(input, "hello world");
    assert.strictEqual(input.getValue(), "hello world");

    input.handleInput("\x17");
    assert.strictEqual(input.getValue(), "hello ");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello world");
  });
}

function undoesCtrlKDeleteLine(): void {
  it("undoes Ctrl+K (delete to line end)", () => {
    const input = new Input();

    typeText(input, "hello world");
    input.handleInput("\x01");
    for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

    input.handleInput("\x0b");
    assert.strictEqual(input.getValue(), "hello ");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello world");
  });
}

function undoesCtrlUDeleteLine(): void {
  it("undoes Ctrl+U (delete to line start)", () => {
    const input = new Input();

    typeText(input, "hello world");
    input.handleInput("\x01");
    for (let i = 0; i < 6; i++) input.handleInput("\x1b[C");

    input.handleInput("\x15");
    assert.strictEqual(input.getValue(), "world");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello world");
  });
}

function undoesYank(): void {
  it("undoes yank", () => {
    const input = new Input();

    typeText(input, "hello ");
    input.handleInput("\x17");
    input.handleInput("\x19");
    assert.strictEqual(input.getValue(), "hello ");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "");
  });
  it("undoes paste atomically", () => {
    const input = new Input();

    input.setValue("hello world");
    input.handleInput("\x01");
    for (let i = 0; i < 5; i++) input.handleInput("\x1b[C");

    input.handleInput("\x1b[200~beep boop\x1b[201~");
    assert.strictEqual(input.getValue(), "hellobeep boop world");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello world");
  });
}

function undoesAltDDeleteWord(): void {
  it("undoes Alt+D (delete word forward)", () => {
    const input = new Input();

    input.setValue("hello world");
    input.handleInput("\x01");

    input.handleInput("\x1bd");
    assert.strictEqual(input.getValue(), " world");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello world");
  });
  it("cursor movement starts new undo unit", () => {
    const input = new Input();

    typeText(input, "abc");
    input.handleInput("\x01");
    input.handleInput("\x05");
    input.handleInput("d");
    input.handleInput("e");
    assert.strictEqual(input.getValue(), "abcde");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "abc");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "");
  });
}

function doesNothingUndoStackEmpty(): void {
  it("does nothing when undo stack is empty", () => {
    const input = new Input();

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "");
  });
  it("coalesces consecutive word characters into one undo unit", () => {
    const input = new Input();

    typeText(input, "hello world");
    assert.strictEqual(input.getValue(), "hello world");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "");
  });
}

function undoesSpacesOneTime(): void {
  it("undoes spaces one at a time", () => {
    const input = new Input();

    typeText(input, "hello  ");
    assert.strictEqual(input.getValue(), "hello  ");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello ");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "");
  });
  it("undoes backspace", () => {
    const input = new Input();

    typeText(input, "hello");
    input.handleInput("\x7f");
    assert.strictEqual(input.getValue(), "hell");

    input.handleInput("\x1b[45;5u");
    assert.strictEqual(input.getValue(), "hello");
  });
}
