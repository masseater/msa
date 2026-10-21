import type LoginDialogComponentClass from "./login-dialog.ts";

declare namespace loginDialogTypes {
  type LoginDialogComponent = (typeof LoginDialogComponentClass)["prototype"];
}

export type { loginDialogTypes as default };
