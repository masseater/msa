declare namespace tuiOverlayLayoutTypes {
  type OverlayAnchor =
    | "center"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center"
    | "left-center"
    | "right-center";

  interface OverlayMargin {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  }

  type SizeValue = number | `${number}%`;

  interface OverlayOptions {
    width?: SizeValue;
    minWidth?: number;
    maxHeight?: SizeValue;

    anchor?: OverlayAnchor;
    offsetX?: number;
    offsetY?: number;

    row?: SizeValue;
    col?: SizeValue;

    margin?: OverlayMargin | number;

    visible?: (termWidth: number, termHeight: number) => boolean;
    nonCapturing?: boolean;
  }
}

export type { tuiOverlayLayoutTypes as default };
