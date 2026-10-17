import assert from "node:assert";
import { it } from "node:test";

import { Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { mountTranscriptWithEditor } from "./tui-alt-screen-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export function tuialtscreenCases5(): void {
  it("routes Home and End to the focused component and Ctrl+Home/End to the transcript", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        const transcript = new ScrollView(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { follow: "end", primary: true },
        );
        const editorInputs = mountTranscriptWithEditor(tui, transcript);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const bottom = transcript.scrollTop;
        assert.ok(bottom > 0);

        const editorKeys = ["\x1bOH", "\x1b[F", "\x1b[57423u", "\x1b[5;5~", "\x1b[6;5~"];
        for (const input of editorKeys) terminal.sendInput(input);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, bottom);
        assert.deepStrictEqual(editorInputs, editorKeys);

        terminal.sendInput("\x1b[1;5H");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 0);

        terminal.sendInput("\x1b[1;5F");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, bottom);
        assert.strictEqual(transcript.isFollowingEnd, true);

        terminal.sendInput("\x1b[57423;5u");
        terminal.sendInput("\x1b[57423;5:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 0);

        terminal.sendInput("\x1b[6~");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 1);
        assert.deepStrictEqual(editorInputs, editorKeys);

        tui.stop();
      }),
    ));
}
