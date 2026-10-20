import type keyIdsTypes from "./key-ids.types.ts";
import type keyProtocolsTypes from "./key-protocols.types.ts";
import type keybindingsTypes from "./keybindings.types.ts";
import type latexTypes from "./latex.types.ts";
import type nativePlatformTypes from "./native-platform.types.ts";
import type programStatusTypes from "./program-status.types.ts";
import type stdinBufferTypes from "./stdin-buffer.types.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";

declare namespace tuiTypesPart3 {
  type KeybindingConflict = keybindingsTypes.KeybindingConflict;
  type KeyEventType = keyProtocolsTypes.KeyEventType;
  type KeyId = keyIdsTypes.KeyId;
  type RenderLatexOptions = latexTypes.RenderLatexOptions;
  type NativeClipboard = nativePlatformTypes.NativeClipboard;
  type ProgramStatus = programStatusTypes.ProgramStatus;
  type StdinBufferEventMap = stdinBufferTypes.StdinBufferEventMap;
  type StdinBufferOptions = stdinBufferTypes.StdinBufferOptions;
  type Terminal = terminalProtocolTypes.Terminal;
  type KeybindingsManager = keybindingsTypes.KeybindingsManager;
  type StdinBuffer = stdinBufferTypes.StdinBuffer;
}

export type { tuiTypesPart3 as default };
