import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { overrideEnv } from "../src/env.ts";
import { MouseRegion, ScrollView, Text, TuiAltScreen } from "../src/index.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  usesButtonMotionTrackingInside();
  invokesRightClickPasteHandler();
  revealsAutoScrollbarPointerEnters();
  jumpsScrollbarTrackPositionContinues();
  letsMouseAwareComponentsConsume();
  restoresKeyboardStateBeforeLeaving();
});

function usesButtonMotionTrackingInside(): void {
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
        { environment: { TMUX: "/tmp/tmux/default,1,0" }, name: "tmux environment" },
        { environment: { TERM: "tmux-256color" }, name: "tmux TERM" },
        { environment: { ZELLIJ: "0" }, name: "Zellij environment" },
        { environment: { STY: "123.session" }, name: "Screen environment" },
        { environment: { TERM: "screen-256color" }, name: "Screen TERM" },
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

function invokesRightClickPasteHandler(): void {
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
}

function revealsAutoScrollbarPointerEnters(): void {
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
}

function jumpsScrollbarTrackPositionContinues(): void {
  it("jumps to a scrollbar track position and continues dragging from there", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(10, 10);
        const tui = new TuiAltScreen(terminal);
        const scrollView = new ScrollView(
          new Text(Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { primary: true, scrollbar: "always" },
        );
        tui.setLayoutRoot(scrollView);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.scrollTop, 0);

        terminal.sendInput("\x1b[<0;10;6M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.scrollTop, 20);

        terminal.sendInput("\x1b[<32;10;10M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(scrollView.scrollTop, 40);

        terminal.sendInput("\x1b[<0;10;10m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(
          terminal.events.every(
            (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
          ),
        );
        tui.stop();
      }),
    ));
}

function letsMouseAwareComponentsConsume(): void {
  it("lets mouse-aware components consume wheel events before viewport scrolling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 3);
        const tui = new TuiAltScreen(terminal);
        let wheelEvents = 0;
        tui.addChild(
          new MouseRegion(
            new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
            (event) => {
              if (event.type !== "wheel") return undefined;
              wheelEvents += 1;
              return { handled: true };
            },
          ),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const viewportTop = tui.viewportTop;

        terminal.sendInput("\x1b[<64;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(wheelEvents, 1);
        assert.strictEqual(tui.viewportTop, viewportTop);
        tui.stop();
      }),
    ));
}

function restoresKeyboardStateBeforeLeaving(): void {
  it("restores keyboard state before leaving alt mode and prints the full document", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 3);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("first\nsecond\nthird\nfourth\nfifth\nsixth", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        tui.stop();

        const startIndex = terminal.events.findIndex((event) => event.type === "start");
        const altScreenEnterIndex = terminal.events.findIndex(
          (event) => event.type === "write" && event.data.includes("\x1b[?1049h"),
        );
        const stopIndex = terminal.events.findIndex((event) => event.type === "stop");
        const mouseDisableIndex = terminal.events.findIndex(
          (event) => event.type === "write" && event.data.includes("\x1b[?1006l"),
        );
        const mainScreenRestoreIndex = terminal.events.findIndex(
          (event) => event.type === "write" && event.data.includes("\x1b[?1049l"),
        );
        assert.ok(altScreenEnterIndex >= 0 && altScreenEnterIndex < startIndex);
        assert.ok(mouseDisableIndex >= 0 && mouseDisableIndex < stopIndex);
        assert.ok(mainScreenRestoreIndex > stopIndex);

        const restoreEvent = terminal.events[mainScreenRestoreIndex];
        assert.strictEqual(restoreEvent?.type, "write");
        if (restoreEvent?.type === "write") {
          assert.ok(restoreEvent.data.includes("first"));
          assert.ok(restoreEvent.data.includes("second"));
          assert.ok(restoreEvent.data.includes("third"));
          assert.ok(restoreEvent.data.includes("fourth"));
          assert.ok(restoreEvent.data.includes("fifth"));
          assert.ok(restoreEvent.data.includes("sixth"));
          assert.ok(restoreEvent.data.indexOf("first") < restoreEvent.data.indexOf("sixth"));
        }
      }),
    ));
}
