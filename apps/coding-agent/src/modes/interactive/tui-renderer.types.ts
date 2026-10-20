import type tuiTypes from "@msa/tui/index.types";

declare namespace tuiRendererTypes {
  interface InteractiveTuiOptions {
    readonly tuiMode: "regular" | "fullscreen";
    readonly showHardwareCursor: boolean;
    readonly logDirectory: string;
    readonly terminal?: tuiTypes.Terminal | undefined;
    readonly onRightClickPaste?: (() => void) | undefined;
    readonly fullscreenCopyOnSelect?: boolean | undefined;
    readonly fullscreenWheelScrollLines?: tuiTypes.WheelScrollLines | undefined;
  }
}

export type { tuiRendererTypes as default };
