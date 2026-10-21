import type nativePlatformTypes from "../native-platform.types.ts";
import type programStatusTypes from "../program-status.types.ts";
import type terminalCapabilitiesTypes from "../terminal-capabilities.types.ts";
import type terminalImageSizeTypes from "../terminal-image-size.types.ts";
import type terminalImageTypes from "../terminal-image.types.ts";
import type terminalProtocolTypes from "../terminal-protocol.types.ts";
import type terminalTypes from "../terminal.types.ts";

declare namespace tuiTerminalKitTypes {
  type NativeClipboard = nativePlatformTypes.NativeClipboard;
  type ProgramStatus = programStatusTypes.ProgramStatus;
  type Terminal = terminalProtocolTypes.Terminal;
  type CellDimensions = terminalCapabilitiesTypes.CellDimensions;
  type ImageProtocol = terminalCapabilitiesTypes.ImageProtocol;
  type TerminalCapabilities = terminalCapabilitiesTypes.TerminalCapabilities;
  type ImageDimensions = terminalImageSizeTypes.ImageDimensions;
  type ImageRenderOptions = terminalImageTypes.ImageRenderOptions;
  type ProcessTerminal = terminalTypes.ProcessTerminal;
}

export type { tuiTerminalKitTypes as default };
