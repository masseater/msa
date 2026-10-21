import type settingsManagerTypes from "../../core/settings-manager.types.ts";

declare namespace extensionTypes {
  interface CodemodeExtensionOptions {
    mode?: settingsManagerTypes.CodemodeMode;

    inlineBudget?: number;

    models?: boolean;
  }
}

export type { extensionTypes as default };
