import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { Container, type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    focusManagementCases3();
  });
});

function focusManagementCases3(): void {
  it("removed replacement restores overlay even when overlay preFocus differs from next focus", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const tui: TUI = new TuiMainScreen(terminal);
    const base = new Container();
    const editor = new FocusableOverlay(["EDITOR"]);
    const palette = new FocusableOverlay(["PALETTE"]);
    const replacement = new FocusableOverlay(["REPLACEMENT"]);
    const overlay = new FocusableOverlay(["OVERLAY"]);
    overlay.handleInput = (data: string) => {
      overlay.inputs.push(data);
      if (data === "b") tui.setFocus(replacement);
    };
    replacement.handleInput = (data: string) => {
      replacement.inputs.push(data);
      if (data === "\r") {
        base.clear();
        base.addChild(editor);
        tui.setFocus(editor);
      }
    };
    base.addChild(editor);
    base.addChild(palette);
    base.addChild(replacement);
    tui.addChild(base);
    tui.setFocus(palette);
    tui.start();
    try {
      tui.showOverlay(overlay);
      terminal.sendInput("b");
      await renderAndFlush(tui, terminal);
      terminal.sendInput("\r");
      terminal.sendInput("x");
      await renderAndFlush(tui, terminal);

      assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
      assert.deepStrictEqual(replacement.inputs, ["\r"]);
      assert.deepStrictEqual(editor.inputs, []);
      assert.strictEqual(overlay.focused, true);
    } finally {
      tui.stop();
    }
  });
}

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("unfocus target releases a blocked overlay while replacement remains focused", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const fallback = new FocusableOverlay(["FALLBACK"]);
      const target = new FocusableOverlay(["TARGET"]);
      const replacement = new FocusableOverlay(["REPLACEMENT"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      replacement.handleInput = (data: string) => {
        replacement.inputs.push(data);
        if (data === "\r") tui.setFocus(fallback);
      };
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        const overlayHandle = tui.showOverlay(overlay);
        overlay.handleInput = (data: string) => {
          overlay.inputs.push(data);
          if (data === "b") {
            tui.setFocus(replacement);
            overlayHandle.unfocus({ target });
          }
        };

        terminal.sendInput("b");
        await renderAndFlush(tui, terminal);
        assert.strictEqual(replacement.focused, true);
        terminal.sendInput("\r");
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);

        assert.deepStrictEqual(overlay.inputs, ["b"]);
        assert.deepStrictEqual(replacement.inputs, ["\r"]);
        assert.deepStrictEqual(fallback.inputs, []);
        assert.deepStrictEqual(target.inputs, ["x"]);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("handleInput restores focus to a visible focused overlay after base focus steal", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const replacement = new FocusableOverlay(["REPLACEMENT"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(overlay);
        assert.strictEqual(overlay.focused, true);
        tui.setFocus(replacement);
        tui.setFocus(editor);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, ["x"]);
        assert.deepStrictEqual(editor.inputs, []);
        assert.strictEqual(overlay.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("handleInput restores focus to explicitly focused raw sub-overlay after base focus steal", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const controller = new FocusableOverlay(["CONTROLLER"]);
      const subOverlay = new FocusableOverlay(["SUB"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(controller);
        const subHandle = tui.showOverlay(subOverlay, { nonCapturing: true });
        subHandle.focus();
        tui.setFocus(editor);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(subOverlay.inputs, ["x"]);
        assert.deepStrictEqual(controller.inputs, []);
        assert.deepStrictEqual(editor.inputs, []);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("passive non-capturing overlay does not regain input after base focus", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const passive = new FocusableOverlay(["PASSIVE"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(passive, { nonCapturing: true });
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(editor.inputs, ["x"]);
        assert.deepStrictEqual(passive.inputs, []);
        assert.strictEqual(editor.focused, true);
      } finally {
        tui.stop();
      }
    });

    it("explicitly focused non-capturing overlay regains input after base focus steal", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["NC"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay, { nonCapturing: true });
        handle.focus();
        tui.setFocus(editor);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, ["x"]);
        assert.deepStrictEqual(editor.inputs, []);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("unfocus() prevents visible overlay from regaining input", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const handle = tui.showOverlay(overlay);
        handle.unfocus();
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(editor.inputs, ["x"]);
        assert.deepStrictEqual(overlay.inputs, []);
        assert.strictEqual(editor.focused, true);
      } finally {
        tui.stop();
      }
    });

    it("setFocus(null) explicitly clears visible overlay restore", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(overlay);
        tui.setFocus(null);
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, []);
        assert.strictEqual(overlay.focused, false);
      } finally {
        tui.stop();
      }
    });
  });
});
