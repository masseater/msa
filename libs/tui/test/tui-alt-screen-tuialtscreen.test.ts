import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { HStack } from "../src/components/h-stack.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { SelectList } from "../src/components/select-list.ts";
import { Text } from "../src/components/text.ts";
import { overrideEnv } from "../src/env.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("invalidates overlays with an explicit layout root", () => {
    const tui = new TuiAltScreen(new VirtualTerminal());
    const overlay = new Text("overlay", 0, 0);
    let invalidated = false;
    overlay.invalidate = () => {
      invalidated = true;
    };
    tui.setLayoutRoot(new Text("root", 0, 0));
    tui.showOverlay(overlay);

    tui.invalidate();

    assert.strictEqual(invalidated, true);
    tui.stop();
  });

  it("routes wheel input to the scroll view under the pointer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const left = new ScrollView(new Text("a1\na2\na3\na4\na5\na6\na7", 0, 0), {
          follow: "end",
          primary: true,
        });
        const right = new ScrollView(new Text("b1\nb2\nb3\nb4\nb5\nb6\nb7", 0, 0), {
          follow: "end",
        });
        tui.setLayoutRoot(
          new HStack([
            { component: left, basis: 10, shrink: 0 },
            { component: right, basis: 10, shrink: 0 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<64;15;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(left.scrollTop, 3);
        assert.strictEqual(right.scrollTop, 2);
        assert.deepStrictEqual(
          terminal.getViewport().map((line) => line.trimEnd()),
          ["a4        b3", "a5        b4", "a6        b5", "a7        b6"],
        );
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("scrolls faster while Alt is held during wheel input", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const text = new Text(
          Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
          0,
          0,
        );
        tui.addChild(text);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 8);

        terminal.sendInput("\x1b[<72;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 3);
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("does not vertically redispatch misses through horizontal layout containers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        let selections = 0;
        const list = new SelectList(
          [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
          2,
          {
            selectedPrefix: (text) => text,
            selectedText: (text) => text,
            description: (text) => text,
            scrollInfo: (text) => text,
            noMatch: (text) => text,
          },
        );
        list.onSelect = () => {
          selections += 1;
        };
        tui.setLayoutRoot(
          new HStack([
            { component: list, basis: 10 },
            { component: new Text("plain", 0, 0), basis: 10 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;15;1M");
        terminal.sendInput("\x1b[<0;15;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(selections, 0);
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  tuialtscreenCases2();
});

function tuialtscreenCases2(): void {
  it("uses button-motion tracking inside terminal multiplexers", () => {
    const environmentKeys = ["TMUX", "ZELLIJ", "STY", "TERM"] as const;
    const cleared = Object.fromEntries(environmentKeys.map((key) => [key, undefined]));
    const restoreEnv = overrideEnv({ ...cleared, TERM: "xterm-256color" });
    try {
      const directTerminal = new RecordingTerminal();
      const directTui = new TuiAltScreen(directTerminal);
      directTui.start();
      const directWrites = directTerminal.events
        .filter((event): event is { type: "write"; data: string } => event.type === "write")
        .map((event) => event.data)
        .join("");
      assert.ok(directWrites.includes("\x1b[?1003h"));
      directTui.stop();

      const multiplexers = [
        { name: "tmux environment", environment: { TMUX: "/tmp/tmux/default,1,0" } },
        { name: "tmux TERM", environment: { TERM: "tmux-256color" } },
        { name: "Zellij environment", environment: { ZELLIJ: "0" } },
        { name: "Screen environment", environment: { STY: "123.session" } },
        { name: "Screen TERM", environment: { TERM: "screen-256color" } },
      ];
      for (const { name, environment } of multiplexers) {
        overrideEnv({ ...cleared, ...environment });
        const terminal = new RecordingTerminal();
        const tui = new TuiAltScreen(terminal);
        tui.start();
        const writes = terminal.events
          .filter((event): event is { type: "write"; data: string } => event.type === "write")
          .map((event) => event.data)
          .join("");
        assert.ok(writes.includes("\x1b[?1002h"), `${name} should enable button-motion tracking`);
        assert.ok(!writes.includes("\x1b[?1003h"), `${name} should not enable all-motion tracking`);
        assert.ok(writes.includes("\x1b[?1006h"), `${name} should enable SGR mouse encoding`);
        tui.stop();
      }
    } finally {
      restoreEnv();
    }
  });
}

describe("TuiAltScreen", () => {
  it("invokes the right-click paste handler only on Windows outside VS Code", () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const restoreEnv = overrideEnv({ TERM_PROGRAM: undefined });
    assert.ok(platformDescriptor);
    const terminal = new VirtualTerminal();
    let pasteCount = 0;
    const tui = new TuiAltScreen(terminal, undefined, undefined, {
      onRightClickPaste: () => {
        pasteCount += 1;
      },
    });
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
      tui.start();
      terminal.sendInput("\x1b[<2;1;1M");
      terminal.sendInput("\x1b[<2;1;1m");
      assert.strictEqual(pasteCount, 1);

      overrideEnv({ TERM_PROGRAM: "vscode" });
      terminal.sendInput("\x1b[<2;1;1M");
      assert.strictEqual(pasteCount, 1);

      Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
      overrideEnv({ TERM_PROGRAM: undefined });
      terminal.sendInput("\x1b[<2;1;1M");
      assert.strictEqual(pasteCount, 1);
    } finally {
      tui.stop();
      Object.defineProperty(process, "platform", platformDescriptor);
      restoreEnv();
    }
  });
});

describe("TuiAltScreen", () => {
  it("reveals an auto scrollbar when the pointer enters its hidden track", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(10, 5);
        const tui = new TuiAltScreen(terminal);
        const scrollView = new ScrollView(
          new Text(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { primary: true, scrollbar: "auto", scrollbarHideDelayMs: 20 },
        );
        tui.setLayoutRoot(scrollView);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.isScrollbarVisible, false);

        terminal.sendInput("\x1b[<35;10;3M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.isScrollbarVisible, true);
        assert.strictEqual(scrollView.isScrollbarActive, true);
        assert.ok(terminal.getViewport().some((line) => /[│█]/u.test(line)));

        terminal.sendInput("\x1b[<35;9;3M");
        yield* Effect.sleep(40);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.isScrollbarVisible, false);
        tui.stop();
      }),
    ));
});
