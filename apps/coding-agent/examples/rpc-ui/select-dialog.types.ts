import type SelectDialogClass from "./select-dialog.ts";

declare namespace selectDialogTypes {
  type SelectDialog = (typeof SelectDialogClass)["prototype"];
}

export type { selectDialogTypes as default };
