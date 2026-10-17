import * as fs from "node:fs";
import * as path from "node:path";

import { Clock, DateTime, Effect } from "effect";
import { dual } from "effect/Function";

import { type CancelDelay, runAfter, runEvery } from "./delay.ts";
import { readEnv } from "./env.ts";
import { setKittyProtocolActive } from "./keys.ts";
import { isNativeModifierPressed } from "./native-modifiers.ts";
import { getNativePlatformHelper } from "./native-platform.ts";
import {
  formatProgramStatus,
  isProgramStatusReply,
  PROGRAM_STATUS_QUERY,
  type ProgramStatus,
} from "./program-status.ts";
import { StdinBuffer } from "./stdin-buffer.ts";

const TERMINAL_PROGRESS_KEEPALIVE_MS = 1000;
const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";
const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0\x07";
const NATIVE_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
const DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;
const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;
const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1b[?u`;
const DEVICE_ATTRIBUTES_QUERY = "\x1b[c";

export type KeyboardProtocolNegotiationSequence =
  | { type: "kitty-flags"; flags: number }
  | { type: "device-attributes" };

export function parseKeyboardProtocolNegotiationSequence(
  sequence: string,
): KeyboardProtocolNegotiationSequence | undefined {
  const kittyFlags = sequence.match(/^\x1b\[\?(\d+)u$/u);
  if (kittyFlags !== null) {
    return { type: "kitty-flags", flags: Number.parseInt(kittyFlags[1]!, 10) };
  }
  if (/^\x1b\[\?[\d;]*c$/u.test(sequence)) {
    return { type: "device-attributes" };
  }
  return undefined;
}

function isKeyboardProtocolNegotiationSequencePrefix(sequence: string): boolean {
  return sequence === "\x1b[" || /^\x1b\[\?[\d;]*$/u.test(sequence);
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

export class ProcessTerminal implements Terminal {
  private wasRaw = false;
  private inputHandler?: ((data: string) => void) | undefined;
  private resizeHandler?: (() => void) | undefined;
  #kittyProtocolActive = false;
  #modifyOtherKeysActive = false;
  private keyboardProtocolPushed = false;
  private pendingKeyboardProtocolDeviceAttributes = 0;
  private keyboardProtocolNegotiationBuffer = "";
  private cancelKeyboardProtocolBufferFlush?: CancelDelay | undefined;
  private stdinBuffer?: StdinBuffer | undefined;
  private stdinDataHandler?: ((data: string) => void) | undefined;
  private cancelProgressKeepalive?: CancelDelay | undefined;
  private programStatus?: ProgramStatus | undefined;
  private programStatusSupported = false;
  private programStatusQueryPending = false;
  private writeLogPath = (() => {
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
        return path.join(env, `tui-${ts}-${process.pid}.log`);
      }
    } catch {}
    return env;
  })();

  get kittyProtocolActive(): boolean {
    return this.#kittyProtocolActive;
  }

  get modifyOtherKeysActive(): boolean {
    return this.#modifyOtherKeysActive;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;

    this.wasRaw = process.stdin.isRaw || false;
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    process.stdout.write("\x1b[?2004h");

    process.stdout.on("resize", this.resizeHandler);

    refreshTerminalDimensions();

    this.enableWindowsVTInput();

    this.queryAndEnableKittyProtocol();
  }

  private setupStdinBuffer(): void {
    this.stdinBuffer = new StdinBuffer({ escapeTimeout: resolveEscapeTimeoutMs() });

    this.stdinBuffer.on("data", (sequence) => {
      if (isProgramStatusReply(sequence)) {
        if (this.programStatusQueryPending) {
          this.programStatusQueryPending = false;
          this.programStatusSupported = true;
          this.writeProgramStatus();
        }
        return;
      }
      const negotiation = this.readKeyboardProtocolNegotiationSequence(sequence);
      if (negotiation === "pending") {
        this.scheduleKeyboardProtocolNegotiationBufferFlush();
        return;
      }
      if (
        negotiation !== undefined &&
        this.handleKeyboardProtocolNegotiationSequence(negotiation.parsed)
      ) {
        return;
      }

      this.forwardInputSequence(negotiation?.sequence ?? sequence);
    });

    this.stdinBuffer.on("paste", (content) => {
      if (this.inputHandler !== undefined) {
        this.inputHandler(`\x1b[200~${content}\x1b[201~`);
      }
    });

    this.stdinDataHandler = (data: string) => {
      this.stdinBuffer!.process(data);
    };
  }

  private queryAndEnableKittyProtocol(): void {
    this.setupStdinBuffer();
    process.stdin.on("data", this.stdinDataHandler!);
    this.keyboardProtocolPushed = true;
    this.pendingKeyboardProtocolDeviceAttributes += 1;
    this.clearKeyboardProtocolNegotiationBuffer();
    const programStatusOverride = readEnv("MSA_PROGRAM_STATUS");
    this.programStatusSupported = programStatusOverride === "1";
    this.programStatusQueryPending = programStatusOverride !== "1" && programStatusOverride !== "0";
    const programStatusQuery = this.programStatusQueryPending ? PROGRAM_STATUS_QUERY : "";
    process.stdout.write(
      `${KITTY_KEYBOARD_PROTOCOL_QUERY}${programStatusQuery}${DEVICE_ATTRIBUTES_QUERY}`,
    );
    this.writeProgramStatus();
  }

  private handleKeyboardProtocolNegotiationSequence(
    negotiationSequence: KeyboardProtocolNegotiationSequence,
  ): boolean {
    this.clearKeyboardProtocolNegotiationBuffer();
    if (negotiationSequence.type === "device-attributes") {
      if (this.pendingKeyboardProtocolDeviceAttributes === 0) return false;
      this.pendingKeyboardProtocolDeviceAttributes -= 1;
      if (this.pendingKeyboardProtocolDeviceAttributes === 0)
        this.programStatusQueryPending = false;
    }
    if (negotiationSequence.type === "kitty-flags") {
      if (negotiationSequence.flags === 0) {
        this.enableModifyOtherKeys();
      } else {
        this.disableModifyOtherKeys();
        if (!this.#kittyProtocolActive) {
          this.#kittyProtocolActive = true;
          setKittyProtocolActive(true);
        }
      }
      return true;
    }

    if (!this.#kittyProtocolActive) {
      this.enableModifyOtherKeys();
    }
    return true;
  }

  private readKeyboardProtocolNegotiationSequence(
    sequence: string,
  ): { parsed: KeyboardProtocolNegotiationSequence; sequence: string } | "pending" | undefined {
    if (this.keyboardProtocolNegotiationBuffer !== "") {
      const bufferedSequence = this.keyboardProtocolNegotiationBuffer + sequence;
      const negotiationSequence = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
      if (negotiationSequence !== undefined) {
        this.clearKeyboardProtocolNegotiationBuffer();
        return { parsed: negotiationSequence, sequence: bufferedSequence };
      }
      if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
        this.setKeyboardProtocolNegotiationBuffer(bufferedSequence);
        return "pending";
      }
      this.flushKeyboardProtocolNegotiationBufferAsInput();
    }

    const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
    if (negotiationSequence !== undefined) return { parsed: negotiationSequence, sequence };
    if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
      this.setKeyboardProtocolNegotiationBuffer(sequence);
      return "pending";
    }
    return undefined;
  }

  private setKeyboardProtocolNegotiationBuffer(sequence: string): void {
    this.clearKeyboardProtocolNegotiationBufferFlushTimer();
    this.keyboardProtocolNegotiationBuffer = sequence;
  }

  private clearKeyboardProtocolNegotiationBuffer(): void {
    this.clearKeyboardProtocolNegotiationBufferFlushTimer();
    this.keyboardProtocolNegotiationBuffer = "";
  }

  private flushKeyboardProtocolNegotiationBufferAsInput(): void {
    if (this.keyboardProtocolNegotiationBuffer === "") return;
    const sequence = this.keyboardProtocolNegotiationBuffer;
    this.clearKeyboardProtocolNegotiationBuffer();
    this.forwardInputSequence(sequence);
  }

  private scheduleKeyboardProtocolNegotiationBufferFlush(): void {
    if (
      this.keyboardProtocolNegotiationBuffer === "" ||
      this.cancelKeyboardProtocolBufferFlush !== undefined
    )
      return;
    this.cancelKeyboardProtocolBufferFlush = runAfter(
      KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS,
      () => {
        this.cancelKeyboardProtocolBufferFlush = undefined;
        this.flushKeyboardProtocolNegotiationBufferAsInput();
      },
    );
  }

  private clearKeyboardProtocolNegotiationBufferFlushTimer(): void {
    if (this.cancelKeyboardProtocolBufferFlush === undefined) return;
    this.cancelKeyboardProtocolBufferFlush();
    this.cancelKeyboardProtocolBufferFlush = undefined;
  }

  private forwardInputSequence(sequence: string): void {
    if (this.inputHandler === undefined) return;
    const shouldDetectNativeShiftEnter =
      sequence === "\r" && (isAppleTerminalSession() || process.platform === "win32");
    const input = normalizeNativeShiftEnterInput(
      sequence,
      shouldDetectNativeShiftEnter,
      shouldDetectNativeShiftEnter && isNativeModifierPressed("shift"),
    );
    this.inputHandler(input);
  }

  private enableModifyOtherKeys(): void {
    if (this.#kittyProtocolActive || this.#modifyOtherKeysActive) return;
    process.stdout.write("\x1b[>4;2m");
    this.#modifyOtherKeysActive = true;
  }

  private disableModifyOtherKeys(): void {
    if (!this.#modifyOtherKeysActive) return;
    process.stdout.write("\x1b[>4;0m");
    this.#modifyOtherKeysActive = false;
  }

  private enableWindowsVTInput(): void {
    if (process.platform !== "win32") return;
    try {
      getNativePlatformHelper()?.enableVirtualTerminalInput?.();
    } catch {}
  }

  drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this.#kittyProtocolActive;
        this.clearKeyboardProtocolNegotiationBuffer();
        if (shouldDisableKittyProtocol) {
          process.stdout.write("\x1b[<u");
          this.keyboardProtocolPushed = false;
          this.#kittyProtocolActive = false;
          setKittyProtocolActive(false);
        }
        this.disableModifyOtherKeys();

        const previousHandler = this.inputHandler;
        this.inputHandler = undefined;

        const clock = yield* Clock.Clock;
        let lastDataTime = clock.currentTimeMillisUnsafe();
        const onData = (): void => {
          lastDataTime = clock.currentTimeMillisUnsafe();
        };

        process.stdin.on("data", onData);
        const endTime = clock.currentTimeMillisUnsafe() + maxMs;

        const waitUntilIdle = Effect.gen(function* () {
          for (;;) {
            const now = clock.currentTimeMillisUnsafe();
            const timeLeft = endTime - now;
            if (timeLeft <= 0 || now - lastDataTime >= idleMs) return;
            yield* Effect.sleep(Math.min(idleMs, timeLeft));
          }
        });

        yield* waitUntilIdle.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              process.stdin.removeListener("data", onData);
              this.inputHandler = previousHandler;
            }),
          ),
        );
      }),
    );
  }

  stop(): void {
    if (this.clearProgressInterval()) {
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
    if (this.programStatusSupported && this.programStatus !== undefined) {
      process.stdout.write(formatProgramStatus({ state: "clear" }));
    }
    this.programStatusSupported = false;
    this.programStatusQueryPending = false;

    process.stdout.write("\x1b[?2004l");

    const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this.#kittyProtocolActive;
    this.clearKeyboardProtocolNegotiationBuffer();

    if (shouldDisableKittyProtocol) {
      process.stdout.write("\x1b[<u");
      this.keyboardProtocolPushed = false;
      this.#kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    this.disableModifyOtherKeys();

    if (this.stdinBuffer !== undefined) {
      this.stdinBuffer.destroy();
      this.stdinBuffer = undefined;
    }

    if (this.stdinDataHandler !== undefined) {
      process.stdin.removeListener("data", this.stdinDataHandler);
      this.stdinDataHandler = undefined;
    }
    this.inputHandler = undefined;
    if (this.resizeHandler !== undefined) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    process.stdin.pause();

    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(this.wasRaw);
    }
  }

  write(data: string): void {
    process.stdout.write(data);
    if (this.writeLogPath !== "") {
      try {
        fs.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
      } catch {}
    }
  }

  get columns(): number {
    return process.stdout.columns || Number(readEnv("COLUMNS")) || 80;
  }

  get rows(): number {
    return process.stdout.rows || Number(readEnv("LINES")) || 24;
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      process.stdout.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      process.stdout.write(`\x1b[${-lines}A`);
    }
  }

  hideCursor(): void {
    process.stdout.write("\x1b[?25l");
  }

  showCursor(): void {
    process.stdout.write("\x1b[?25h");
  }

  clearLine(): void {
    process.stdout.write("\x1b[K");
  }

  clearFromCursor(): void {
    process.stdout.write("\x1b[J");
  }

  clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }

  setProgramStatus(status: ProgramStatus): void {
    this.programStatus = status.state === "clear" ? undefined : status;
    if (this.programStatusSupported) process.stdout.write(formatProgramStatus(status));
  }

  private writeProgramStatus(): void {
    if (this.programStatusSupported && this.programStatus !== undefined) {
      process.stdout.write(formatProgramStatus(this.programStatus));
    }
  }

  setProgress(active: boolean): void {
    if (active) {
      process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
      if (this.cancelProgressKeepalive === undefined) {
        this.cancelProgressKeepalive = runEvery(TERMINAL_PROGRESS_KEEPALIVE_MS, () => {
          process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
        });
      }
    } else {
      this.clearProgressInterval();
      process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
    }
  }

  private clearProgressInterval(): boolean {
    if (this.cancelProgressKeepalive === undefined) return false;
    this.cancelProgressKeepalive();
    this.cancelProgressKeepalive = undefined;
    return true;
  }
}
