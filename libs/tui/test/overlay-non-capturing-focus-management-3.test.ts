import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("blocked replacement setFocus(null) resumes the visible overlay", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const replacement = new FocusableOverlay(["REPLACEMENT"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      replacement.handleInput = (data: string) => {
        replacement.inputs.push(data);
        if (data === "\r") tui.setFocus(null);
      };
      overlay.handleInput = (data: string) => {
        overlay.inputs.push(data);
        if (data === "b") tui.setFocus(replacement);
      };
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(overlay);
        terminal.sendInput("b");
        await renderAndFlush(tui, terminal);
        terminal.sendInput("\r");
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(replacement.inputs, ["\r"]);
        assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
        assert.strictEqual(overlay.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("temporarily invisible focused overlay falls back without losing restore eligibility", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      let visible = true;
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(overlay, { visible: () => visible });
        tui.setFocus(editor);
        visible = false;
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(editor.inputs, ["x"]);
        assert.deepStrictEqual(overlay.inputs, []);
        visible = true;
        terminal.sendInput("y");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(editor.inputs, ["x"]);
        assert.deepStrictEqual(overlay.inputs, ["y"]);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("temporarily invisible focused overlay with null preFocus restores when visible again", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      let visible = true;
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(overlay, { visible: () => visible });
        visible = false;
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, []);
        visible = true;
        terminal.sendInput("y");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, ["y"]);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("cyclic overlay preFocus ancestry does not hang focus changes", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(overlay);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay, { nonCapturing: true });
        handle.focus();
        tui.setFocus(editor);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(editor.inputs, ["x"]);
        assert.deepStrictEqual(overlay.inputs, []);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("handleInput restores the focus-order top overlay after base focus steal", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const lower = new FocusableOverlay(["LOWER"]);
      const upper = new FocusableOverlay(["UPPER"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const lowerHandle = tui.showOverlay(lower);
        tui.showOverlay(upper);
        lowerHandle.focus();
        tui.setFocus(editor);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(lower.inputs, ["x"]);
        assert.deepStrictEqual(upper.inputs, []);
        assert.deepStrictEqual(editor.inputs, []);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("hideOverlay() does not reassign focus when topmost overlay is non-capturing", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const capturing = new FocusableOverlay(["CAP"]);
      const nonCapturing = new FocusableOverlay(["NC"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(capturing);
        tui.showOverlay(nonCapturing, { nonCapturing: true });
        assert.strictEqual(capturing.focused, true);
        tui.hideOverlay();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(capturing.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("multiple capturing and non-capturing overlays restore focus through removals", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const c1 = new FocusableOverlay(["C1"]);
      const n1 = new FocusableOverlay(["N1"]);
      const c2 = new FocusableOverlay(["C2"]);
      const n2 = new FocusableOverlay(["N2"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const c1Handle = tui.showOverlay(c1);
        tui.showOverlay(n1, { nonCapturing: true });
        const c2Handle = tui.showOverlay(c2);
        tui.showOverlay(n2, { nonCapturing: true });
        assert.strictEqual(c2.focused, true);
        c2Handle.hide();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(c1.focused, true);
        c1Handle.hide();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("capturing overlay unfocus() on topmost capturing overlay falls back to preFocus", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const capturing = new FocusableOverlay(["CAP"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(capturing);
        assert.strictEqual(capturing.focused, true);
        handle.unfocus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(editor.focused, true);
        assert.strictEqual(capturing.focused, false);
      } finally {
        tui.stop();
      }
    });
  });
});
