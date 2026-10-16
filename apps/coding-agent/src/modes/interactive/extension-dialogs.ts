import type { Component, TUI } from "@msa/tui";

import type { ExtensionUIDialogOptions } from "../../core/extensions/index.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionInputComponent } from "./components/extension-input.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import type { EditorSlot } from "./editor-slot.ts";
import type { BlockedStatus, ProgramStatusReporter } from "./program-status-reporter.ts";

type Dialog = Component & { dispose?(): void };

export interface ExtensionDialogsHost {
  readonly ui: TUI;
  readonly editorSlot: EditorSlot;
  readonly programStatus: ProgramStatusReporter;
  readonly keybindings: KeybindingsManager;
  getExternalEditorCommand(): string | undefined;
  toggleToolsExpanded(): void;
}

/**
 * The select, confirm, input, and editor dialogs extensions open in the editor slot. One dialog is
 * shown at a time; it reports the program as blocked on the user until it closes.
 */
export class ExtensionDialogs {
  private readonly host: ExtensionDialogsHost;
  private active: Dialog | undefined;

  constructor(host: ExtensionDialogsHost) {
    this.host = host;
  }

  select(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
    blocked: BlockedStatus = { kind: "question", message: title },
  ): Promise<string | undefined> {
    return this.open<string>(
      (finish) =>
        new ExtensionSelectorComponent(
          title,
          options,
          (option) => finish(option),
          () => finish(undefined),
          {
            tui: this.host.ui,
            timeout: opts?.timeout,
            onToggleToolsExpanded: () => this.host.toggleToolsExpanded(),
          },
        ),
      blocked,
      opts?.signal,
    );
  }

  async confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    const result = await this.select(`${title}\n${message}`, ["Yes", "No"], opts, {
      kind: "permission",
      message: title,
    });
    return result === "Yes";
  }

  input(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return this.open<string>(
      (finish) =>
        new ExtensionInputComponent(
          title,
          placeholder,
          (value) => finish(value),
          () => finish(undefined),
          { tui: this.host.ui, timeout: opts?.timeout },
        ),
      { kind: "question", message: title },
      opts?.signal,
    );
  }

  /** A multi-line editor that can hand its text to the external editor. */
  editor(title: string, prefill?: string): Promise<string | undefined> {
    return this.open<string>(
      (finish) =>
        new ExtensionEditorComponent(
          this.host.ui,
          this.host.keybindings,
          title,
          prefill,
          (value) => finish(value),
          () => finish(undefined),
          undefined,
          this.host.getExternalEditorCommand(),
        ),
      { kind: "question", message: title },
    );
  }

  /** Closes the open dialog without answering it. */
  close(): void {
    this.closeDialog(this.active);
  }

  private open<T>(
    create: (finish: (value: T | undefined) => void) => Dialog,
    blocked: BlockedStatus,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(undefined);
        return;
      }
      let dialog: Dialog | undefined;
      const finish = (value: T | undefined) => {
        signal?.removeEventListener("abort", onAbort);
        this.closeDialog(dialog);
        resolve(value);
      };
      const onAbort = () => finish(undefined);
      signal?.addEventListener("abort", onAbort, { once: true });

      dialog = create(finish);
      this.active = dialog;
      this.host.editorSlot.disposeActiveSelector();
      this.host.editorSlot.show(dialog);
      this.host.programStatus.setBlocked("extension-dialog", blocked);
    });
  }

  private closeDialog(dialog: Dialog | undefined): void {
    if (!dialog || dialog !== this.active) return;
    dialog.dispose?.();
    this.active = undefined;
    this.host.programStatus.setBlocked("extension-dialog", undefined);
    this.host.editorSlot.restoreEditor();
  }
}
