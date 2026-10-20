declare namespace colorsTypes {
  interface IndexedColor {
    readonly kind: "indexed";
    readonly index: number;
  }

  interface RgbColorValue {
    readonly kind: "rgb";
    readonly r: number;
    readonly g: number;
    readonly b: number;
  }

  interface OklchColorValue {
    readonly kind: "oklch";
    readonly l: number;
    readonly c: number;
    readonly h: number;
  }

  type Color = IndexedColor | RgbColorValue | OklchColorValue;

  type TerminalColorMode = "256color" | "truecolor";

  type ColorMixSpace = "oklch" | "srgb";

  interface OklchChannels {
    l: number;
    c: number;
    h: number;
  }

  interface OkhslChannels {
    h: number;
    s: number;
    l: number;
  }

  interface TextAttributes {
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    strikethrough?: boolean;
  }

  interface TextStyle extends TextAttributes {
    fg?: Color;
    bg?: Color;
  }
}

export type { colorsTypes as default };
