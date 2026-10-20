import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";

declare namespace altScreenTerminalModesTypes {
  interface ImageCapabilities {
    protocol: terminalCapabilitiesTypes.ImageProtocol;
    saved: terminalCapabilitiesTypes.TerminalCapabilities | undefined;
  }
}

export type { altScreenTerminalModesTypes as default };
