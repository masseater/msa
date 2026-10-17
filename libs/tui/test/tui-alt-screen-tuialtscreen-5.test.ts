import assert from "node:assert";
import { describe, it } from "node:test";

import { ScrollView } from "../src/components/scroll-view.ts";
import {
  encodeKitty,
  registerKittyImageMetadata,
  resetCapabilitiesCache,
  setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import {
  tuialtscreenCases6,
  tuialtscreenCases7,
} from "./tui-alt-screen-tuialtscreen-5-cases-helpers.ts";

describe("TuiAltScreen", () => {
  it("redraws WezTerm Kitty images after writes to covered rows", async () => {
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
