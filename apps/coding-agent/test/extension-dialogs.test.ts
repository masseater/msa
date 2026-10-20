import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import ExtensionInputComponent from "../src/modes/interactive/components/extension-input.ts";
import ExtensionSelectorComponent from "../src/modes/interactive/components/extension-selector.ts";
import EditorSlot from "../src/modes/interactive/editor-slot.ts";
import ExtensionDialogs from "../src/modes/interactive/extension-dialogs.ts";
import type programStatusReporterTypes from "../src/modes/interactive/program-status-reporter.types.ts";
import tuiKit from "./tui-kit.ts";
const { Container, Editor, TuiMainScreen, setKeybindings } = tui;

const { KeybindingsManager, VirtualTerminal, getEditorTheme, initTheme } = tuiKit;

const { abortController, awaited, runTest } = testing;

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
    editorSlot,
    getExternalEditorCommand: () => undefined,
    keybindings,
    programStatus: { setBlocked } as unknown as programStatusReporterTypes.ProgramStatusReporter,
    toggleToolsExpanded: () => {},
    ui,
  });
  return { container, dialogs, editor, setBlocked };
}

const answersASelectAndPutsTheEditor = () =>
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
  );

const resolvesUndefinedWhenTheExtensionAbortsThe = () =>
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
  );

const keepsANewerDialogOpenWhenA = () =>
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
  );

describe("ExtensionDialogs", () => {
  it("answers a select and puts the editor back", answersASelectAndPutsTheEditor);

  it(
    "resolves undefined when the extension aborts the dialog",
    resolvesUndefinedWhenTheExtensionAbortsThe,
  );

  it("keeps a newer dialog open when a displaced one is aborted", keepsANewerDialogOpenWhenA);
});
