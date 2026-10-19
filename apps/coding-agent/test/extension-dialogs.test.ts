import { awaited, runTest, abortController } from "@msa/testing";
import { Container, Editor, setKeybindings, TuiMainScreen } from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ExtensionInputComponent } from "../src/modes/interactive/components/extension-input.ts";
import { ExtensionSelectorComponent } from "../src/modes/interactive/components/extension-selector.ts";
import { EditorSlot } from "../src/modes/interactive/editor-slot.ts";
import { ExtensionDialogs } from "../src/modes/interactive/extension-dialogs.ts";
import type { ProgramStatusReporter } from "../src/modes/interactive/program-status-reporter.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

beforeAll(() => initTheme("dark"));

function createDialogs() {
  const keybindings = new KeybindingsManager();
  setKeybindings(keybindings);
  const ui = new TuiMainScreen(new VirtualTerminal());
  const container = new Container();
  const editor = new Editor(ui, getEditorTheme());
  const editorSlot = new EditorSlot(container, ui, () => editor);
  editorSlot.show(editor);
  const setBlocked = vi.fn();
  const dialogs = new ExtensionDialogs({
    ui,
    editorSlot,
    programStatus: { setBlocked } as unknown as ProgramStatusReporter,
    keybindings,
    getExternalEditorCommand: () => undefined,
    toggleToolsExpanded: () => {},
  });
  return { dialogs, container, editor, setBlocked };
}

describe("ExtensionDialogs", () => {
  it("answers a select and puts the editor back", () =>
    runTest(
      Effect.gen(function* () {
        const { dialogs, container, editor, setBlocked } = createDialogs();
        const answer = dialogs.select("Pick", ["a", "b"]);
        const selector = container.children[0];
        expect(selector).toBeInstanceOf(ExtensionSelectorComponent);
        expect(setBlocked).toHaveBeenLastCalledWith("extension-dialog", {
          kind: "question" as const,
          message: "Pick",
        });

        selector!.handleInput!("j");
        selector!.handleInput!("\r");

        yield* awaited(expect(answer).resolves.toBe("b"));
        expect(container.children).toEqual([editor]);
        expect(setBlocked).toHaveBeenLastCalledWith("extension-dialog", undefined);
      }),
    ));

  it("resolves undefined when the extension aborts the dialog", () =>
    runTest(
      Effect.gen(function* () {
        const { dialogs, container, editor } = createDialogs();
        const controller = abortController();
        const answer = dialogs.input("Name", undefined, { signal: controller.signal });
        expect(container.children[0]).toBeInstanceOf(ExtensionInputComponent);

        controller.abort();

        yield* awaited(expect(answer).resolves.toBeUndefined());
        expect(container.children).toEqual([editor]);
      }),
    ));

  it("keeps a newer dialog open when a displaced one is aborted", () =>
    runTest(
      Effect.gen(function* () {
        const { dialogs, container } = createDialogs();
        const controller = abortController();
        const displaced = dialogs.select("First", ["a"], { signal: controller.signal });
        void dialogs.input("Second");
        const current = container.children[0];

        controller.abort();

        yield* awaited(expect(displaced).resolves.toBeUndefined());
        expect(container.children).toEqual([current]);
      }),
    ));
});
