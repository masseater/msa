import * as fs from "node:fs";

import { DateTime, Effect } from "effect";
import { dual } from "effect/Function";

import { CSI, matchCsiSequence } from "./ansi-sequences.ts";
import { type CancelDelay, runAfter } from "./delay.ts";
import { readEnv } from "./env.ts";
import { pathOperations } from "./platform.ts";
import type { ProgramStatus } from "./program-status.ts";

const KITTY_FLAGS_BODY = /^\?(\d+)$/u;
const PRIVATE_PARAMETERS_BODY = /^\?[\d;]*$/u;
const NATIVE_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;

export type KeyboardProtocolNegotiationSequence =
  | { type: "kitty-flags"; flags: number }
  | { type: "device-attributes" };

export function parseKeyboardProtocolNegotiationSequence(
  sequence: string,
): KeyboardProtocolNegotiationSequence | undefined {
  const kittyFlags = matchCsiSequence({ data: sequence, finals: "u", body: KITTY_FLAGS_BODY });
  if (kittyFlags !== null) {
    return { type: "kitty-flags", flags: Number.parseInt(kittyFlags.groups[1]!, 10) };
  }
  if (matchCsiSequence({ data: sequence, finals: "c", body: PRIVATE_PARAMETERS_BODY }) !== null) {
    return { type: "device-attributes" };
  }
  return undefined;
}

export function isKeyboardProtocolNegotiationSequencePrefix(sequence: string): boolean {
  return (
    sequence === CSI ||
    (sequence.startsWith(CSI) && PRIVATE_PARAMETERS_BODY.test(sequence.slice(CSI.length)))
  );
}

export function isAppleTerminalSession(): boolean {
  return process.platform === "darwin" && readEnv("TERM_PROGRAM") === "Apple_Terminal";
}

export function refreshTerminalDimensions(): void {
  if (process.platform === "win32" || process.pid <= 0) return;
  try {
    process.kill(process.pid, "SIGWINCH");
  } catch {}
}

export const normalizeNativeShiftEnterInput: {
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

export const normalizeAppleTerminalInput: {
  (data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string;
  (isAppleTerminal: boolean, isShiftPressed: boolean): (data: string) => string;
} = dual(3, (data: string, isAppleTerminal: boolean, isShiftPressed: boolean): string =>
  normalizeNativeShiftEnterInput(data, isAppleTerminal, isShiftPressed),
);

export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;

  stop(): void;

  drainInput(maxMs?: number, idleMs?: number): Promise<void>;

  write(data: string): void;

  get columns(): number;
  get rows(): number;

  get kittyProtocolActive(): boolean;

  moveBy(lines: number): void;

  hideCursor(): void;
  showCursor(): void;

  clearLine(): void;
  clearFromCursor(): void;
  clearScreen(): void;

  setTitle(title: string): void;

  setProgress(active: boolean): void;

  setProgramStatus(status: ProgramStatus): void;
}

const DEFAULT_ESCAPE_TIMEOUT_MS = 10;
const DEFAULT_SSH_ESCAPE_TIMEOUT_MS = 100;

export function resolveEscapeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
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

export function resolveWriteLogPath(): string {
  const env = readEnv("MSA_TUI_WRITE_LOG") ?? "";
  if (env === "") return "";
  try {
    if (fs.statSync(env).isDirectory()) {
      const now = DateTime.toParts(
        DateTime.makeZonedUnsafe(Effect.runSync(DateTime.now), {
          timeZone: DateTime.zoneMakeLocal(),
        }),
      );
      const pad = (value: number): string => String(value).padStart(2, "0");
      const ts = `${now.year}-${pad(now.month)}-${pad(now.day)}_${pad(now.hour)}-${pad(now.minute)}-${pad(now.second)}`;
      return pathOperations.join(env, `tui-${ts}-${process.pid}.log`);
    }
  } catch {}
  return env;
}

export const appendWriteLog: {
  (path: string, data: string): void;
  (data: string): (path: string) => void;
} = dual(2, (path: string, data: string): void => {
  if (path === "") return;
  try {
    fs.appendFileSync(path, data, { encoding: "utf8" });
  } catch {}
});

type NegotiationRead =
  | { parsed: KeyboardProtocolNegotiationSequence; sequence: string }
  | "pending"
  | undefined;

export class KeyboardNegotiationBuffer {
  private buffer = "";
  private cancelFlush: CancelDelay | undefined;
  private readonly forward: (sequence: string) => void;

  constructor(forward: (sequence: string) => void) {
    this.forward = forward;
  }

  read(sequence: string): NegotiationRead {
    if (this.buffer !== "") {
      const bufferedSequence = this.buffer + sequence;
      const negotiationSequence = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
      if (negotiationSequence !== undefined) {
        this.clear();
        return { parsed: negotiationSequence, sequence: bufferedSequence };
      }
      if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
        this.set(bufferedSequence);
        return "pending";
      }
      this.flushAsInput();
    }

    const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
    if (negotiationSequence !== undefined) return { parsed: negotiationSequence, sequence };
    if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
      this.set(sequence);
      return "pending";
    }
    return undefined;
  }

  scheduleFlush(): void {
    if (this.buffer === "" || this.cancelFlush !== undefined) return;
    this.cancelFlush = runAfter(KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS, () => {
      this.cancelFlush = undefined;
      this.flushAsInput();
    });
  }

  clear(): void {
    this.clearTimer();
    this.buffer = "";
  }

  private set(sequence: string): void {
    this.clearTimer();
    this.buffer = sequence;
  }

  private flushAsInput(): void {
    if (this.buffer === "") return;
    const sequence = this.buffer;
    this.clear();
    this.forward(sequence);
  }

  private clearTimer(): void {
    if (this.cancelFlush === undefined) return;
    this.cancelFlush();
    this.cancelFlush = undefined;
  }
}
