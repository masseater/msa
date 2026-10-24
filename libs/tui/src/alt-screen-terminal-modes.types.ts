import type terminalCapabilitiesTypes from "./terminal-capabilities.types.ts";

declare namespace altScreenTerminalModesTypes {
  interface ImageCapabilities {
    protocol: terminalCapabilitiesTypes.ImageProtocol;
    suspended: boolean;
  }
}

export type { altScreenTerminalModesTypes as default };
