import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import tuiRenderer from "../src/modes/interactive/tui-renderer.ts";
import RecordingTerminal from "./interactive-tui-support.ts";
import tuiKit from "./tui-kit.ts";

const { KeybindingsManager, initTheme } = tuiKit;

const { createInteractiveTui } = tuiRenderer;

const { ScrollView, Text, getKeybindings, isViewportTUI, setKeybindings } = tui;
const { awaited, runTest } = testing;

const showsTheConfiguredJumpToBottomShortcut = Effect.gen(function* () {
  initTheme("dark");
  const previousKeybindings = getKeybindings();
  setKeybindings(new KeybindingsManager({ "tui.altScreen.bottom": "ctrl+j" }));
  const terminal = new RecordingTerminal(50, 4);
  const ui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal,
    tuiMode: "fullscreen",
  });
  ui.setLayoutRoot(
    new ScrollView(
      new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      {
        follow: "end",
        primary: true,
      },
    ),
  );
  ui.start();
  try {
    yield* awaited(terminal.waitForRender());
    terminal.sendInput("\x1b[<64;1;1M");
    yield* awaited(terminal.waitForRender());
    expect(terminal.getViewport()[3]).toContain("↓ Jump to latest message · Ctrl+J");
  } finally {
    ui.stop();
    setKeybindings(previousKeybindings);
  }
});

const selectsTheAlternateScreenRendererOnlyWhen = Effect.gen(function* () {
  const mainTerminal = new RecordingTerminal();
  const mainTui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal: mainTerminal,
    tuiMode: "regular",
  });
  expect(mainTui.mode).toBe("regular");
  expect(isViewportTUI(mainTui)).toBe(false);
  mainTui.start();
  yield* awaited(mainTerminal.waitForRender());
  expect(mainTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(false);
  mainTui.stop();

  const altTerminal = new RecordingTerminal();
  const altTui = createInteractiveTui({
    logDirectory: "/tmp",
    showHardwareCursor: false,
    terminal: altTerminal,
    tuiMode: "fullscreen",
  });
  expect(altTui.mode).toBe("fullscreen");
  expect(isViewportTUI(altTui)).toBe(true);
  altTui.start();
  yield* awaited(altTerminal.waitForRender());
  expect(altTerminal.writes.some((write) => write.includes("\x1b[?1049h"))).toBe(true);
  altTui.stop();
});

describe("createInteractiveTui", () => {
  it("selects the alternate-screen renderer only when requested", () =>
    runTest(selectsTheAlternateScreenRendererOnlyWhen));

  it("shows the configured jump-to-bottom shortcut while scrolled up", () =>
    runTest(showsTheConfiguredJumpToBottomShortcut));
});
