import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import externalEditor from "../external-editor.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import type extensionEditorTypes from "./extension-editor.types.ts";
import keybindingHints from "./keybinding-hints.ts";

const { getEditorTheme, theme } = themeModule;
const { keyHint } = keybindingHints;
const { editWhileSuspended } = externalEditor;

const { Editor, Spacer, Text, getKeybindings } = tuiModule;

export default class ExtensionEditorComponent
  extends tuiModule.Container
  implements tuiTypes.Focusable
{
  private editor: tuiTypes.Editor;
  private onSubmitCallback: (value: string) => void;
  private onCancelCallback: () => void;
  private tui: tuiTypes.TUI;
  private keybindings: keybindingsTypes.KeybindingsManager;
  private externalEditorCommand: string;

  private focusedState = false;
  get focused(): boolean {
    return this.focusedState;
  }
  set focused(value: boolean) {
    this.focusedState = value;
    this.editor.focused = value;
  }

  constructor(
    tui: tuiTypes.TUI,
    keybindings: keybindingsTypes.KeybindingsManager,
    title: string,
    prefill: string | undefined,
    onSubmit: (value: string) => void,
    onCancel: () => void,
    options: extensionEditorTypes.ExtensionEditorOptions | undefined,
    externalEditorCommand: string,
  ) {
    super();

    this.tui = tui;
    this.keybindings = keybindings;
    this.externalEditorCommand = externalEditorCommand;
    this.onSubmitCallback = onSubmit;
    this.onCancelCallback = onCancel;
    const { description, ...editorOptions } = options ?? {};

    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));

    this.addChild(new Text(theme.fg("accent", title), 1, 0));
    if (description !== undefined && description !== "") {
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("text", description), 1, 0));
    }
    this.addChild(new Spacer(1));

    this.editor = new Editor(tui, getEditorTheme(), editorOptions);
    ExtensionEditorComponent.addEditorWithHints(this, prefill);
  }

  private static addEditorWithHints(
    self: ExtensionEditorComponent,
    prefill: string | undefined,
  ): void {
    if (prefill !== undefined && prefill !== "") {
      self.editor.setText(prefill);
    }
    self.editor.onSubmit = (text: string) => {
      self.onSubmitCallback(text);
    };
    self.addChild(self.editor);

    self.addChild(new Spacer(1));

    const hint =
      keyHint("tui.select.confirm", "submit") +
      "  " +
      keyHint("tui.input.newLine", "newline") +
      "  " +
      keyHint("tui.select.cancel", "cancel") +
      `  ${keyHint("app.editor.external", "external editor")}`;
    self.addChild(new Text(hint, 1, 0));

    self.addChild(new Spacer(1));

    self.addChild(new DynamicBorder());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancelCallback();
      return;
    }

    if (this.keybindings.matches(keyData, "app.editor.external")) {
      void Effect.runFork(this.handleOpenExternalEditor());
      return;
    }

    this.editor.handleInput(keyData);
  }

  private handleOpenExternalEditor(): Effect.Effect<void> {
    return editWhileSuspended(
      this.tui,
      { command: this.externalEditorCommand, content: this.editor.getText() },
      (content) => this.editor.setText(content),
    );
  }
}
