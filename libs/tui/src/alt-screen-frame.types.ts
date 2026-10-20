import type altScreenKittyCacheTypes from "./alt-screen-kitty-cache.types.ts";
import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";

declare namespace altScreenFrameTypes {
  interface AltScreenFrameInput {
    screen: string[];
    previousScreen: readonly string[];
    previousWidth: number;
    previousHeight: number;
    width: number;
    height: number;
    imageProtocol: terminalCapabilitiesTypes.ImageProtocol;
    kittyImages: altScreenKittyCacheTypes.KittyImageCache;
    cursor: { row: number; col: number } | null;
    showHardwareCursor: boolean;
  }

  interface AltScreenFrameOutput {
    buffer: string;
    fullRedraw: boolean;
  }

  interface FlashFrame {
    width: number;
    height: number;
  }
}

export type { altScreenFrameTypes as default };
