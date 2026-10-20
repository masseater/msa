declare namespace terminalCapabilitiesTypes {
  type ImageProtocol = "kitty" | "iterm2" | null;

  interface TerminalCapabilities {
    images: ImageProtocol;
    trueColor: boolean;
    hyperlinks: boolean;
  }

  interface CellDimensions {
    widthPx: number;
    heightPx: number;
  }
}

export type { terminalCapabilitiesTypes as default };
