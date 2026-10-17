import assert from "node:assert";
import { it } from "node:test";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export function tuialtscreenCases5(): void {
  it("routes Home and End to the focused component and Ctrl+Home/End to the transcript", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    const transcript = new ScrollView(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      { follow: "end", primary: true },
    );
    const editorInputs: string[] = [];
    const editor = {
      focused: false,
      render: () => ["editor"],
      invalidate: () => {},
      handleInput: (data: string) => editorInputs.push(data),
    };
    tui.setLayoutRoot(
      new VStack([
        { component: transcript, basis: 0, grow: 1, minSize: 1 },
        { component: editor, basis: 1, shrink: 0 },
      ]),
    );
    tui.setFocus(editor);
    tui.start();
    await terminal.waitForRender();

    const bottom = transcript.scrollTop;
    assert.ok(bottom > 0);

    // #10314: unmodified Home/End belong to the editor in every UI mode.
    const editorKeys = ["\x1bOH", "\x1b[F", "\x1b[57423u", "\x1b[5;5~", "\x1b[6;5~"];
    for (const input of editorKeys) terminal.sendInput(input);
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, bottom);
    assert.deepStrictEqual(editorInputs, editorKeys);

    terminal.sendInput("\x1b[1;5H");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 0);

    terminal.sendInput("\x1b[1;5F");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, bottom);
    assert.strictEqual(transcript.isFollowingEnd, true);

    terminal.sendInput("\x1b[57423;5u");
    terminal.sendInput("\x1b[57423;5:3u");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 0);

    terminal.sendInput("\x1b[6~");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 1);
    assert.deepStrictEqual(editorInputs, editorKeys);

    tui.stop();
  });
}
