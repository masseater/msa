declare namespace terminalColorsTypes {
  interface RgbColor {
    r: number;
    g: number;
    b: number;
  }

  type TerminalColorScheme = "dark" | "light";

  interface TerminalColors {
    foreground?: RgbColor | undefined;
    background?: RgbColor | undefined;
    palette?: RgbColor[] | undefined;
  }

  type OscColorTarget = "foreground" | "background" | number;
}

export type { terminalColorsTypes as default };
