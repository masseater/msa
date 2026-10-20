import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import { awaited, awaitingWith } from "../../core/awaiting.ts";
import type { ExtensionUIDialogOptions } from "../../core/extensions/index.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { ExtensionEditorComponent } from "./components/extension-editor.ts";
import { ExtensionInputComponent } from "./components/extension-input.ts";
import { ExtensionSelectorComponent } from "./components/extension-selector.ts";
import type { EditorSlot } from "./editor-slot.ts";
import type { BlockedStatus, ProgramStatusReporter } from "./program-status-reporter.ts";

type Dialog = tuiTypes.Component & { dispose?(): void };

export interface ExtensionDialogsHost {
  readonly ui: tuiTypes.TUI;
  readonly editorSlot: EditorSlot;
  readonly programStatus: ProgramStatusReporter;
  readonly keybindings: KeybindingsManager;
  getExternalEditorCommand(): string | undefined;
  toggleToolsExpanded(): void;
}

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
            onToggleToolsExpanded: () => this.host.toggleToolsExpanded(),
            timeout: opts?.timeout,
            tui: this.host.ui,
          },
        ),
      blocked,
      opts?.signal,
    );
  }

  confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const result = yield* awaited(
          this.select(`${title}\n${message}`, ["Yes", "No"], opts, {
            kind: "permission",
            message: title,
          }),
        );
        return result === "Yes";
      }, this),
    );
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
          { timeout: opts?.timeout, tui: this.host.ui },
        ),
      { kind: "question", message: title },
      opts?.signal,
    );
  }

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

  close(): void {
    this.closeDialog(this.active);
  }

  private open<T>(
    create: (finish: (value: T | undefined) => void) => Dialog,
    blocked: BlockedStatus,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    return Effect.runPromise(
      Effect.callback<T | undefined>((resume) => {
        const resolve = (value: T | undefined) => resume(Effect.succeed(value));
        if (signal?.aborted === true) {
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
      }),
    );
  }

  private closeDialog(dialog: Dialog | undefined): void {
    if (dialog === undefined || dialog !== this.active) return;
    dialog.dispose?.();
    this.active = undefined;
    this.host.programStatus.setBlocked("extension-dialog", undefined);
    this.host.editorSlot.restoreEditor();
  }
}
