import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("no-op guards", () => {
    it("focus() on hidden overlay is a no-op", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay, { nonCapturing: true });
        handle.setHidden(true);
        handle.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
        assert.strictEqual(handle.isFocused(), false);
      } finally {
        tui.stop();
      }
    });

    it("focus() after hide() is a no-op", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay, { nonCapturing: true });
        handle.hide();
        handle.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
        assert.strictEqual(handle.isFocused(), false);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("no-op guards", () => {
    it("unfocus() when overlay does not have focus is a no-op", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay, { nonCapturing: true });
        handle.unfocus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
        assert.strictEqual(overlay.focused, false);
      } finally {
        tui.stop();
      }
    });

    it("unfocus() with null preFocus clears focus and does not route input back to overlay", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        const handle = tui.showOverlay(overlay);
        assert.strictEqual(overlay.focused, true);
        handle.unfocus();
        assert.strictEqual(overlay.focused, false);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, []);
        assert.strictEqual(handle.isFocused(), false);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("toggle focus between non-capturing overlays then unfocus returns to editor", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const a = new FocusableOverlay(["A"]);
      const b = new FocusableOverlay(["B"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const aHandle = tui.showOverlay(a, { nonCapturing: true });
        const bHandle = tui.showOverlay(b, { nonCapturing: true });
        aHandle.focus();
        bHandle.focus();
        aHandle.focus();
        aHandle.unfocus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
        assert.strictEqual(a.focused, false);
        assert.strictEqual(b.focused, false);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    focusCyclePreventionCases4();
  });
});

function focusCyclePreventionCases4(): void {
  it("explicit unfocus target supports cycling between three overlays and editor", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const tui: TUI = new TuiMainScreen(terminal);
    const editor = new FocusableOverlay(["EDITOR"]);
    const a = new FocusableOverlay(["A"]);
    const b = new FocusableOverlay(["B"]);
    const c = new FocusableOverlay(["C"]);
    tui.addChild(new EmptyContent());
    tui.setFocus(editor);
    tui.start();
    try {
      const aHandle = tui.showOverlay(a);
      const bHandle = tui.showOverlay(b);
      const cHandle = tui.showOverlay(c);

      aHandle.focus();
      terminal.sendInput("a");
      await renderAndFlush(tui, terminal);
      bHandle.focus();
      terminal.sendInput("b");
      await renderAndFlush(tui, terminal);
      cHandle.focus();
      terminal.sendInput("c");
      await renderAndFlush(tui, terminal);
      cHandle.unfocus({ target: editor });
      terminal.sendInput("e");
      await renderAndFlush(tui, terminal);
      aHandle.focus();
      terminal.sendInput("A");
      await renderAndFlush(tui, terminal);
      aHandle.unfocus({ target: editor });
      terminal.sendInput("E");
      await renderAndFlush(tui, terminal);

      assert.deepStrictEqual(a.inputs, ["a", "A"]);
      assert.deepStrictEqual(b.inputs, ["b"]);
      assert.deepStrictEqual(c.inputs, ["c"]);
      assert.deepStrictEqual(editor.inputs, ["e", "E"]);
      assert.strictEqual(editor.focused, true);
    } finally {
      tui.stop();
    }
  });
}

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("explicit null unfocus target clears focus without restoring overlays", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        const handle = tui.showOverlay(overlay);
        handle.unfocus({ target: null });
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, []);
        assert.strictEqual(handle.isFocused(), false);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("hiding focused overlay falls back to next visual-frontmost overlay", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const a = new FocusableOverlay(["A"]);
      const b = new FocusableOverlay(["B"]);
      const c = new FocusableOverlay(["C"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const aHandle = tui.showOverlay(a);
        const bHandle = tui.showOverlay(b);
        tui.showOverlay(c);
        aHandle.focus();
        bHandle.focus();
        bHandle.setHidden(true);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(a.inputs, ["x"]);
        assert.deepStrictEqual(c.inputs, []);
        assert.strictEqual(a.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});
