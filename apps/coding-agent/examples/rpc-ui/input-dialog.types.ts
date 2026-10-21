import type InputDialogClass from "./input-dialog.ts";

declare namespace inputDialogTypes {
  type InputDialog = (typeof InputDialogClass)["prototype"];
}

export type { inputDialogTypes as default };
