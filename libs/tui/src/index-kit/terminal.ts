import nativePlatform from "../native-platform.ts";
import programStatus from "../program-status.ts";
import terminalCapabilitiesProbe from "../terminal-capabilities-probe.ts";
import terminalCapabilities from "../terminal-capabilities.ts";
import terminalColors from "../terminal-colors.ts";
import terminalImageKitty from "../terminal-image-kitty.ts";
import terminalImageSize from "../terminal-image-size.ts";
import terminalImage from "../terminal-image.ts";
import terminalProtocol from "../terminal-protocol.ts";
import ProcessTerminal from "../terminal.ts";

const terminalKit: {
  readonly ProcessTerminal: typeof ProcessTerminal;
  readonly nativePlatform: typeof nativePlatform;
  readonly programStatus: typeof programStatus;
  readonly terminalCapabilities: typeof terminalCapabilities;
  readonly terminalCapabilitiesProbe: typeof terminalCapabilitiesProbe;
  readonly terminalColors: typeof terminalColors;
  readonly terminalImage: typeof terminalImage;
  readonly terminalImageKitty: typeof terminalImageKitty;
  readonly terminalImageSize: typeof terminalImageSize;
  readonly terminalProtocol: typeof terminalProtocol;
} = {
  ProcessTerminal,
  nativePlatform,
  programStatus,
  terminalCapabilities,
  terminalCapabilitiesProbe,
  terminalColors,
  terminalImage,
  terminalImageKitty,
  terminalImageSize,
  terminalProtocol,
};

export default terminalKit;
