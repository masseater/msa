import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Editor } from "../src/components/editor.ts";
import { SettingsList } from "../src/components/settings-list.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { editorTheme, settingsTheme } from "./mouse-components-helpers.ts";
import { SubmenuHost } from "./mouse-components-submenu-host.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("mouse-aware components", () => {
  it("keeps a settings list focused when a click in its submenu closes the submenu", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(30, 6);
        const tui = new TuiAltScreen(terminal);
        const changes: Array<{ id: string; value: string }> = [];
        const list = new SettingsList(
          [
            {
              id: "theme",
              label: "Theme",
              currentValue: "first",
              submenu: (_value, done) => new SubmenuHost(done),
            },
            { id: "other", label: "Other", currentValue: "off", values: ["off", "on"] },
          ],
          5,
          settingsTheme,
          (id, value) => changes.push({ id, value }),
          () => {},
        );
        tui.addChild(list);
        tui.setFocus(list);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\r");
        yield* Effect.promise(() => terminal.waitForRender());
        terminal.sendInput("\x1b[<0;3;2M");
        terminal.sendInput("\x1b[<0;3;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(changes, [{ id: "theme", value: "second" }]);
        assert.strictEqual(tui.getFocusedComponent(), list);

        terminal.sendInput("\x1b[B");
        terminal.sendInput("\r");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(changes, [
          { id: "theme", value: "second" },
          { id: "other", value: "on" },
        ]);
        tui.stop();
      }),
    ));
});

describe("mouse-aware components", () => {
  it("positions and focuses the multiline editor through alternate-screen dispatch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        const editor = new Editor(tui, editorTheme);
        editor.setText("hello");
        tui.addChild(editor);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;3;2M");
        terminal.sendInput("\x1b[<0;3;2m");
        terminal.sendInput("X");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(editor.getText(), "heXllo");
        assert.strictEqual(tui.getFocusedComponent(), editor);
        tui.stop();
      }),
    ));
});
