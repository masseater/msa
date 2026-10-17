import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Editor } from "../src/components/editor.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { editorTheme } from "./mouse-components-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("mouse-aware components", () => {
  it("selects and copies editor text on drag instead of moving the cursor", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const copied: string[] = [];
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copySelection: (text) => {
            copied.push(text);
            return Promise.resolve(true);
          },
        });
        const editor = new Editor(tui, editorTheme);
        editor.setText("hello world");
        tui.addChild(editor);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const cursorBefore = editor.getCursor();

        terminal.sendInput("\x1b[<0;1;2M");
        terminal.sendInput("\x1b[<32;5;2M");
        terminal.sendInput("\x1b[<0;5;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(copied, ["hello"]);
        assert.deepStrictEqual(editor.getCursor(), cursorBefore);
        tui.stop();
      }),
    ));
});
