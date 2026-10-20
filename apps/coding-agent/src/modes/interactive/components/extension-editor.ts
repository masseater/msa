import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { awaited, awaitingWith } from "../../../core/awaiting.ts";
import type { KeybindingsManager } from "../../../core/keybindings.ts";
import { readEnv } from "../../../core/process-env.ts";
import { editInExternalEditor } from "../external-editor.ts";
import { getEditorTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";

const { Container, Editor, Spacer, Text, getKeybindings } = tuiModule;

export interface ExtensionEditorOptions extends tuiTypes.EditorOptions {
  description?: string;
}

export class ExtensionEditorComponent extends Container implements tuiTypes.Focusable {
  private editor: tuiTypes.Editor;
  private onSubmitCallback: (value: string) => void;
  private onCancelCallback: () => void;
  private tui: tuiTypes.TUI;
  private keybindings: KeybindingsManager;
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
    keybindings: KeybindingsManager,
    title: string,
    prefill: string | undefined,
    onSubmit: (value: string) => void,
    onCancel: () => void,
    options?: ExtensionEditorOptions,
    externalEditorCommand?: string,
  ) {
    super();

    this.tui = tui;
    this.keybindings = keybindings;
    this.externalEditorCommand =
      externalEditorCommand ||
      readEnv("VISUAL") ||
      readEnv("EDITOR") ||
      (process.platform === "win32" ? "notepad" : "nano");
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
    ExtensionEditorComponent.buildPart1(this, prefill);
  }

  private static buildPart1(self: ExtensionEditorComponent, prefill: string | undefined): void {
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
    return awaitingWith(function* () {
      const content = this.editor.getText();
      this.tui.stop();
      try {
        const result = yield* awaited(
          editInExternalEditor({
            command: this.externalEditorCommand,
            content,
          }),
        );
        if (result.status === "complete") {
          this.editor.setText(result.content);
        }
      } finally {
        this.tui.start();
        this.tui.requestRender(true);
      }
    }, this);
  }
}
