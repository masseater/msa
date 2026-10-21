import type tuiTypes from "@msa/tui/index.types";

import type EditorSlotClass from "./editor-slot.ts";

declare namespace editorSlotTypes {
  type SelectorFactory = (done: () => void) => {
    component: tuiTypes.Component;
    focus: tuiTypes.Component;
    dispose?: () => void;
  };

  type EditorSlot = (typeof EditorSlotClass)["prototype"];
}

export type { editorSlotTypes as default };
