import { dual } from "effect/Function";

import ansiSequences from "./ansi-sequences.ts";
import envModule from "./env.ts";
import KeyboardNegotiationBuffer from "./keyboard-negotiation-buffer.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";

const { CSI, matchCsiSequence } = ansiSequences;
const { readEnv } = envModule;

const KITTY_FLAGS_BODY = /^\?(\d+)$/u;
const PRIVATE_PARAMETERS_BODY = /^\?[\d;]*$/u;
const NATIVE_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";

function parseKeyboardProtocolNegotiationSequence(
  sequence: string,
): terminalProtocolTypes.KeyboardProtocolNegotiationSequence | undefined {
  const kittyFlags = matchCsiSequence({ body: KITTY_FLAGS_BODY, data: sequence, finals: "u" });
  if (kittyFlags !== null) {
    return { flags: Number.parseInt(kittyFlags.groups[1]!, 10), type: "kitty-flags" };
  }
  if (matchCsiSequence({ body: PRIVATE_PARAMETERS_BODY, data: sequence, finals: "c" }) !== null) {
    return { type: "device-attributes" };
  }
  return undefined;
}

function isKeyboardProtocolNegotiationSequencePrefix(sequence: string): boolean {
  return (
    sequence === CSI ||
    (sequence.startsWith(CSI) && PRIVATE_PARAMETERS_BODY.test(sequence.slice(CSI.length)))
  );
}

function isAppleTerminalSession(): boolean {
  return process.platform === "darwin" && readEnv("TERM_PROGRAM") === "Apple_Terminal";
}

function refreshTerminalDimensions(): void {
  if (process.platform === "win32" || process.pid <= 0) return;
  try {
    process.kill(process.pid, "SIGWINCH");
  } catch {}
}

const normalizeNativeShiftEnterInput: {
  (data: string, shouldDetectNativeShiftEnter: boolean, isShiftPressed: boolean): string;
  (shouldDetectNativeShiftEnter: boolean, isShiftPressed: boolean): (data: string) => string;
} = dual(
  3,
  (data: string, shouldDetectNativeShiftEnter: boolean, isShiftPressed: boolean): string => {
    if (shouldDetectNativeShiftEnter && data === "\r" && isShiftPressed)
      return NATIVE_SHIFT_ENTER_SEQUENCE;
    return data;
  },
);

const normalizeAppleTerminalInput: {
  (data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string;
  (isAppleTerminal: boolean, isShiftPressed: boolean): (data: string) => string;
} = dual(3, (data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string =>
  normalizeNativeShiftEnterInput(data, isAppleTerminal, isShiftPressed),
);

const DEFAULT_ESCAPE_TIMEOUT_MS = 10;
const DEFAULT_SSH_ESCAPE_TIMEOUT_MS = 100;

function resolveEscapeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env["MSA_TUI_ESC_TIMEOUT"]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  if (
    (env["SSH_CONNECTION"] !== undefined && env["SSH_CONNECTION"] !== "") ||
    (env["SSH_TTY"] !== undefined && env["SSH_TTY"] !== "")
  ) {
    return DEFAULT_SSH_ESCAPE_TIMEOUT_MS;
  }
  return DEFAULT_ESCAPE_TIMEOUT_MS;
}

const terminalProtocol = {
  KeyboardNegotiationBuffer,
  isAppleTerminalSession,
  isKeyboardProtocolNegotiationSequencePrefix,
  normalizeAppleTerminalInput,
  normalizeNativeShiftEnterInput,
  parseKeyboardProtocolNegotiationSequence,
  refreshTerminalDimensions,
  resolveEscapeTimeoutMs,
};

export default terminalProtocol;
