import env from "./env.ts";
import keys from "./keys.ts";
import nativeModifiers from "./native-modifiers.ts";
import nativePlatform from "./native-platform.ts";
import StdinBuffer from "./stdin-buffer.ts";
import stdinIdle from "./stdin-idle.ts";
import terminalProtocolQueries from "./terminal-protocol-queries.ts";
const terminalKit = {
  StdinBuffer,
  env,
  keys,
  nativeModifiers,
  nativePlatform,
  stdinIdle,
  terminalProtocolQueries,
};

export default terminalKit;
