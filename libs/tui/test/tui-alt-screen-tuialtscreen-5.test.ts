import assert from "node:assert";
import { describe, it } from "node:test";

import { HStack } from "../src/components/h-stack.ts";
import { Image } from "../src/components/image.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import {
  encodeKitty,
  registerKittyImageMetadata,
  resetCapabilitiesCache,
  setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { scrollLineByLine } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
  it("redraws WezTerm Kitty images after writes to covered rows", async () => {
    // Regression test for #10319: a scrollbar update below an unchanged image anchor erased its cells.
    const weztermPane = process.env["WEZTERM_PANE"];
    let tui: TuiAltScreen | undefined;
    process.env["WEZTERM_PANE"] = "1";
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 4);
      const imageId = 10319;
      const imageLine = encodeKitty("AAAA", { columns: 2, rows: 3, imageId, moveCursor: false });
      registerKittyImageMetadata({ imageId, columns: 2, rows: 3, widthPx: 100, heightPx: 100 });
      let coveredLine = "";
      tui = new TuiAltScreen(terminal);
      tui.setLayoutRoot({
        render: () => [imageLine, coveredLine, "", "after"],
        invalidate: () => {},
      });
      tui.start();
      await terminal.waitForRender();
      const eventCount = terminal.events.length;

      coveredLine = "changed";
      tui.requestRender();
      await terminal.waitForRender();
      const redrawWrites = terminal.events
        .slice(eventCount)
        .filter((event): event is { type: "write"; data: string } => event.type === "write")
        .map((event) => event.data)
        .join("");
      const placementIndex = redrawWrites.indexOf("\x1b_Ga=p,q=2");
      assert.ok(redrawWrites.includes("\x1b_Ga=d,d=a,q=2\x1b\\"));
      assert.ok(placementIndex > redrawWrites.indexOf("changed"));
      assert.ok(!redrawWrites.includes("\x1b_Ga=T"));
    } finally {
      tui?.stop();
      resetCapabilitiesCache();
      if (weztermPane === undefined) delete process.env["WEZTERM_PANE"];
      else process.env["WEZTERM_PANE"] = weztermPane;
    }
  });
});

describe("TuiAltScreen", () => {
  tuialtscreenCases6();
});

function tuialtscreenCases6(): void {
  it("reuses moved Kitty images without dropping HStack siblings", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 6);
      const tui = new TuiAltScreen(terminal);
      const label = new Text("left", 0, 0);
      const image = new Image(
        "A".repeat(8192),
        "image/png",
        { fallbackColor: (value) => value },
        {},
        { widthPx: 100, heightPx: 100 },
      );
      const header = new Text("header", 0, 0);
      const row = new HStack([
        { component: label, basis: 10 },
        { component: image, basis: 10 },
      ]);
      tui.setLayoutRoot(
        new VStack([
          { component: header, basis: "auto" },
          { component: row, basis: 4 },
        ]),
      );
      tui.start();
      await terminal.waitForRender();
      assert.ok(
        terminal.events.some((event) => event.type === "write" && event.data.includes("\x1b_Ga=T")),
      );

      const eventCount = terminal.events.length;
      label.setText("changed");
      header.setText("header\nsecond");
      tui.requestRender();
      await terminal.waitForRender();
      const redrawWrites = terminal.events
        .slice(eventCount)
        .filter((event): event is { type: "write"; data: string } => event.type === "write")
        .map((event) => event.data)
        .join("");
      const placementIndex = redrawWrites.indexOf("\x1b_Ga=p,q=2");
      assert.ok(redrawWrites.includes("\x1b_Ga=d,d=a,q=2\x1b\\"));
      assert.ok(placementIndex > redrawWrites.indexOf("changed"));
      assert.ok(!redrawWrites.includes("\x1b_Ga=T"));
      assert.ok(
        redrawWrites.length < 2000,
        `expected placement-only redraw, got ${redrawWrites.length} bytes`,
      );
      assert.ok(terminal.getViewport().some((line) => line.trimEnd() === "changed"));
      tui.stop();
    } finally {
      resetCapabilitiesCache();
    }
  });
}

describe("TuiAltScreen", () => {
  it("retains recently offscreen Kitty images for placement-only reuse", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 1);
      const tui = new TuiAltScreen(terminal);
      const imageId = 321;
      const imageLine = encodeKitty("AAAA", { columns: 2, rows: 1, imageId, moveCursor: false });
      registerKittyImageMetadata({ imageId, columns: 2, rows: 1, widthPx: 100, heightPx: 50 });
      tui.setLayoutRoot(
        new ScrollView(
          {
            render: () => [imageLine, "after"],
            invalidate: () => {},
          },
          { primary: true },
        ),
      );
      tui.start();
      await terminal.waitForRender();
      assert.ok(
        terminal.events.some((event) => event.type === "write" && event.data.includes("\x1b_Ga=T")),
      );

      const eventCount = terminal.events.length;
      tui.scrollBy(1);
      await terminal.waitForRender();
      tui.scrollBy(-1);
      await terminal.waitForRender();
      const reentryWrites = terminal.events
        .slice(eventCount)
        .filter((event): event is { type: "write"; data: string } => event.type === "write")
        .map((event) => event.data)
        .join("");
      assert.ok(reentryWrites.includes("\x1b_Ga=p,q=2"));
      assert.ok(!reentryWrites.includes("\x1b_Ga=T"));
      assert.ok(!reentryWrites.includes(`\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`));
      tui.stop();
    } finally {
      resetCapabilitiesCache();
    }
  });
});

describe("TuiAltScreen", () => {
  tuialtscreenCases7();
});

function tuialtscreenCases7(): void {
  it("evicts the least recently visible Kitty image when the cache is full", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 1);
      const tui = new TuiAltScreen(terminal);
      const firstImageId = 500;
      const imageLines = Array.from({ length: 18 }, (_, index) => {
        const imageId = firstImageId + index;
        registerKittyImageMetadata({ imageId, columns: 2, rows: 1, widthPx: 100, heightPx: 50 });
        return encodeKitty("AAAA", { columns: 2, rows: 1, imageId, moveCursor: false });
      });
      tui.setLayoutRoot(
        new ScrollView(
          {
            render: () => imageLines,
            invalidate: () => {},
          },
          { primary: true },
        ),
      );
      tui.start();
      await terminal.waitForRender();
      await scrollLineByLine(tui, terminal, imageLines.length - 1);
      assert.ok(
        terminal.events.some(
          (event) =>
            event.type === "write" &&
            event.data.includes(`\x1b_Ga=d,d=I,i=${firstImageId},q=2\x1b\\`),
        ),
      );

      const eventCount = terminal.events.length;
      tui.scrollToTop();
      await terminal.waitForRender();
      const reentryWrites = terminal.events
        .slice(eventCount)
        .filter((event): event is { type: "write"; data: string } => event.type === "write")
        .map((event) => event.data)
        .join("");
      assert.ok(reentryWrites.includes("\x1b_Ga=T"));
      tui.stop();
    } finally {
      resetCapabilitiesCache();
    }
  });
}

describe("TuiAltScreen", () => {
  it("evicts offscreen Kitty images when decoded raster memory exceeds the cache quota", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 1);
      const tui = new TuiAltScreen(terminal);
      const firstImageId = 600;
      const imageLines = Array.from({ length: 4 }, (_, index) => {
        const imageId = firstImageId + index;
        registerKittyImageMetadata({ imageId, columns: 2, rows: 1, widthPx: 3840, heightPx: 2160 });
        return encodeKitty("AAAA", { columns: 2, rows: 1, imageId, moveCursor: false });
      });
      tui.setLayoutRoot(
        new ScrollView(
          {
            render: () => imageLines,
            invalidate: () => {},
          },
          { primary: true },
        ),
      );
      tui.start();
      await terminal.waitForRender();
      await scrollLineByLine(tui, terminal, imageLines.length - 1);
      assert.ok(
        terminal.events.some(
          (event) =>
            event.type === "write" &&
            event.data.includes(`\x1b_Ga=d,d=I,i=${firstImageId},q=2\x1b\\`),
        ),
      );
      tui.stop();
    } finally {
      resetCapabilitiesCache();
    }
  });
});
