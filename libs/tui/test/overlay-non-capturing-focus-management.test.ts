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
    focusManagementCases1();
  });
});

function focusManagementCases1(): void {
  it("microtask-deferred sub-overlay pattern (showExtensionCustom simulation) restores focus", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const tui: TUI = new TuiMainScreen(terminal);
    const editor = new FocusableOverlay(["EDITOR"]);
    const timer = new FocusableOverlay(["TIMER"]);
    const controller = new FocusableOverlay(["CTRL"]);
    tui.addChild(new EmptyContent());
    tui.setFocus(editor);
    tui.start();
    try {
      let timerHandle: ReturnType<typeof tui.showOverlay> | null = null;
      let doneFn: () => void = () => {
        throw new Error("doneFn was not initialized");
      };

      const overlayPromise = new Promise<void>((resolve) => {
        doneFn = () => {
          if (timerHandle === null) throw new Error("timerHandle was not initialized");
          timerHandle.hide();
          tui.hideOverlay();
          resolve();
        };
        timerHandle = tui.showOverlay(timer, { nonCapturing: true });
        Promise.resolve(controller).then((c) => tui.showOverlay(c));
      });

      await Promise.resolve();
      await renderAndFlush(tui, terminal);

      assert.strictEqual(controller.focused, true);
      assert.strictEqual(editor.focused, false);

      doneFn();
      await overlayPromise;
      await renderAndFlush(tui, terminal);

      assert.strictEqual(editor.focused, true, "editor should regain focus");
      assert.strictEqual(controller.focused, false);
      assert.strictEqual(timer.focused, false);

      terminal.sendInput("x");
      await renderAndFlush(tui, terminal);
      assert.deepStrictEqual(editor.inputs, ["x"], "editor should receive input after close");
      assert.deepStrictEqual(controller.inputs, []);
    } finally {
      tui.stop();
    }
  });
}

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("handleInput redirection skips non-capturing overlays when focused overlay becomes invisible", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const fallbackCapturing = new FocusableOverlay(["FALLBACK"]);
      const nonCapturing = new FocusableOverlay(["NC"]);
      const primary = new FocusableOverlay(["PRIMARY"]);
      let isVisible = true;
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(fallbackCapturing);
        tui.showOverlay(nonCapturing, { nonCapturing: true });
        tui.showOverlay(primary, { visible: () => isVisible });
        assert.strictEqual(primary.focused, true);
        isVisible = false;
        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(primary.inputs, []);
        assert.deepStrictEqual(nonCapturing.inputs, []);
        assert.deepStrictEqual(fallbackCapturing.inputs, ["x"]);
        assert.strictEqual(fallbackCapturing.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("active base focus replacement receives close input before overlay restore", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const replacement = new FocusableOverlay(["REPLACEMENT"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      overlay.handleInput = (data: string) => {
        overlay.inputs.push(data);
        if (data === "b") {
          tui.setFocus(replacement);
        }
      };
      replacement.handleInput = (data: string) => {
        replacement.inputs.push(data);
        if (data === "\r") {
          tui.setFocus(editor);
        }
      };
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.showOverlay(overlay);
        assert.strictEqual(overlay.focused, true);
        terminal.sendInput("b");
        await renderAndFlush(tui, terminal);
        assert.strictEqual(replacement.focused, true);

        terminal.sendInput("\r");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(replacement.inputs, ["\r"]);
        assert.deepStrictEqual(overlay.inputs, ["b"]);
        assert.strictEqual(overlay.focused, true);

        terminal.sendInput("x");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("active replacement still receives input when it is another overlay preFocus", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      const replacement = new FocusableOverlay(["REPLACEMENT"]);
      const passive = new FocusableOverlay(["PASSIVE"]);
      const overlay = new FocusableOverlay(["OVERLAY"]);
      overlay.handleInput = (data: string) => {
        overlay.inputs.push(data);
        if (data === "b") {
          tui.setFocus(replacement);
        }
      };
      replacement.handleInput = (data: string) => {
        replacement.inputs.push(data);
        if (data === "\r") {
          tui.setFocus(editor);
        }
      };
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        tui.setFocus(replacement);
        tui.showOverlay(passive, { nonCapturing: true });
        tui.setFocus(editor);
        tui.showOverlay(overlay);
        terminal.sendInput("b");
        await renderAndFlush(tui, terminal);
        assert.strictEqual(replacement.focused, true);

        terminal.sendInput("1");
        terminal.sendInput("\r");
        await renderAndFlush(tui, terminal);
        assert.deepStrictEqual(replacement.inputs, ["1", "\r"]);
        assert.deepStrictEqual(overlay.inputs, ["b"]);
        assert.strictEqual(overlay.focused, true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    focusManagementCases2();
  });
});

function focusManagementCases2(): void {
  it("blocked replacement can move focus internally before overlay restore", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const tui: TUI = new TuiMainScreen(terminal);
    const base = new Container();
    const editor = new FocusableOverlay(["EDITOR"]);
    const firstReplacement = new FocusableOverlay(["FIRST"]);
    const secondReplacement = new FocusableOverlay(["SECOND"]);
    const overlay = new FocusableOverlay(["OVERLAY"]);
    overlay.handleInput = (data: string) => {
      overlay.inputs.push(data);
      if (data === "b") tui.setFocus(firstReplacement);
    };
    firstReplacement.handleInput = (data: string) => {
      firstReplacement.inputs.push(data);
      if (data === "n") tui.setFocus(secondReplacement);
    };
    secondReplacement.handleInput = (data: string) => {
      secondReplacement.inputs.push(data);
      if (data === "\r") {
        base.clear();
        base.addChild(editor);
        tui.setFocus(editor);
      }
    };
    base.addChild(editor);
    base.addChild(firstReplacement);
    base.addChild(secondReplacement);
    tui.addChild(base);
    tui.setFocus(editor);
    tui.start();
    try {
      tui.showOverlay(overlay);
      terminal.sendInput("b");
      await renderAndFlush(tui, terminal);
      terminal.sendInput("n");
      await renderAndFlush(tui, terminal);
      terminal.sendInput("2");
      terminal.sendInput("\r");
      await renderAndFlush(tui, terminal);

      assert.deepStrictEqual(overlay.inputs, ["b"]);
      assert.deepStrictEqual(firstReplacement.inputs, ["n"]);
      assert.deepStrictEqual(secondReplacement.inputs, ["2", "\r"]);
      assert.strictEqual(overlay.focused, true);
    } finally {
      tui.stop();
    }
  });
}
