import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../core/keybindings.types.ts";
import type editorSlotTypes from "./editor-slot.types.ts";
import type ExtensionDialogsClass from "./extension-dialogs.ts";
import type programStatusReporterTypes from "./program-status-reporter.types.ts";

declare namespace extensionDialogsTypes {
  interface ExtensionDialogsHost {
    readonly ui: tuiTypes.TUI;
    readonly editorSlot: editorSlotTypes.EditorSlot;
    readonly programStatus: programStatusReporterTypes.ProgramStatusReporter;
    readonly keybindings: keybindingsTypes.KeybindingsManager;
    getExternalEditorCommand(): string | undefined;
    toggleToolsExpanded(): void;
  }

  type ExtensionDialogs = (typeof ExtensionDialogsClass)["prototype"];
}

export type { extensionDialogsTypes as default };
