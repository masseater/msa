import type altScreenMouseProtocolTypes from "./alt-screen-mouse-protocol.types.ts";
import type AltScreenSelectionClass from "./alt-screen-selection.ts";
import type altScreenViewTypes from "./alt-screen-view.ts";

declare namespace altScreenSelectionTypes {
  interface SelectionHost {
    readonly view: altScreenViewTypes.AltScreenView;
    openUrl: ((url: string) => void) | undefined;
    copyOnSelect(): boolean;
    copySelection(): void;
    dispatchClick(
      event: altScreenMouseProtocolTypes.SgrMouseEvent,
      clickCount: number,
    ): boolean | undefined;
  }

  type AltScreenSelection = AltScreenSelectionClass;
}

export type { altScreenSelectionTypes as default };
