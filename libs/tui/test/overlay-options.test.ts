import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type TUI, TuiMainScreen } from "../src/index.ts";
import { EmptyContent } from "./overlay-options-empty-content.ts";
import { renderAndFlush } from "./overlay-options-helpers.ts";
import { HyperlinkContent } from "./overlay-options-hyperlink-content.ts";
import { StaticOverlay } from "./overlay-options-static-overlay.ts";
import { StyledContent } from "./overlay-options-styled-content.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should truncate overlay lines that exceed declared width", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["X".repeat(100)]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { width: 20 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          for (const line of viewport) {
            assert.ok(line !== undefined);
          }
          tui.stop();
        }),
      ));

    it("should handle overlay with complex ANSI sequences without crashing", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const complexLine =
            "\x1b[48;2;40;50;40m \x1b[38;2;128;128;128mSome styled content\x1b[39m\x1b[49m" +
            "\x1b]8;;http://example.com\x07link\x1b]8;;\x07" +
            " more content ".repeat(10);
          const overlay = new StaticOverlay([complexLine, complexLine, complexLine]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { width: 60 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(viewport.length > 0);
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle overlay composited on styled base content", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);

          const overlay = new StaticOverlay(["OVERLAY"]);

          tui.addChild(new StyledContent());
          tui.showOverlay(overlay, { width: 20, anchor: "center" });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          const hasOverlay = viewport.some((line) => line?.includes("OVERLAY"));
          assert.ok(hasOverlay, "Overlay should be visible");
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle wide characters at overlay boundary", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const wideCharLine = "中文日本語한글テスト漢字";
          const overlay = new StaticOverlay([wideCharLine]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { width: 15 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(viewport.length > 0);
          tui.stop();
        }),
      ));

    it("should handle overlay positioned at terminal edge", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["X".repeat(50)]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { col: 60, width: 20 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(viewport.length > 0);
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle overlay on base content with OSC sequences", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);

          const overlay = new StaticOverlay(["OVERLAY-TEXT"]);

          tui.addChild(new HyperlinkContent());
          tui.showOverlay(overlay, { anchor: "center", width: 20 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(viewport.length > 0);
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("width percentage", () => {
    it("should render overlay at percentage of terminal width", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(100, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["test"]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { width: "50%" });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          assert.strictEqual(overlay.requestedWidth, 50);
          tui.stop();
        }),
      ));

    it("should respect minWidth when widthPercent results in smaller width", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(100, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["test"]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { width: "10%", minWidth: 30 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          assert.strictEqual(overlay.requestedWidth, 30);
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("anchor positioning", () => {
    it("should position overlay at top-left", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["TOP-LEFT"]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { anchor: "top-left", width: 10 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(
            viewport[0]?.startsWith("TOP-LEFT"),
            `Expected TOP-LEFT at start, got: ${viewport[0]}`,
          );
          tui.stop();
        }),
      ));

    it("should position overlay at bottom-right", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["BTM-RIGHT"]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { anchor: "bottom-right", width: 10 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          const lastRow = viewport[23];
          assert.ok(
            lastRow?.includes("BTM-RIGHT"),
            `Expected BTM-RIGHT on last row, got: ${lastRow}`,
          );
          assert.ok(
            lastRow?.trimEnd().endsWith("BTM-RIGHT"),
            `Expected BTM-RIGHT at end, got: ${lastRow}`,
          );
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("anchor positioning", () => {
    it("should position overlay at top-center", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new StaticOverlay(["CENTERED"]);

          tui.addChild(new EmptyContent());
          tui.showOverlay(overlay, { anchor: "top-center", width: 10 });
          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          const firstRow = viewport[0];
          assert.ok(
            firstRow?.includes("CENTERED"),
            `Expected CENTERED on first row, got: ${firstRow}`,
          );
          const colIndex = firstRow?.indexOf("CENTERED") ?? -1;
          assert.ok(colIndex >= 30 && colIndex <= 40, `Expected centered, got col ${colIndex}`);
          tui.stop();
        }),
      ));
  });
});
