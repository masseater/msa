import { Clock, Effect } from "effect";

import { readEnv } from "./env.ts";
import { setKittyProtocolActive } from "./keys.ts";
import { isNativeModifierPressed } from "./native-modifiers.ts";
import { getNativePlatformHelper } from "./native-platform.ts";
import type { ProgramStatus } from "./program-status.ts";
import { StdinBuffer } from "./stdin-buffer.ts";
import {
  isAppleTerminalSession,
  KeyboardNegotiationBuffer,
  type KeyboardProtocolNegotiationSequence,
  normalizeNativeShiftEnterInput,
  refreshTerminalDimensions,
  resolveEscapeTimeoutMs,
  type Terminal,
} from "./terminal-protocol.ts";
import { TerminalStatusReporter } from "./terminal-status.ts";
import { TerminalWriteLog } from "./terminal-write-log.ts";

const DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;
const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1b[?u`;
const DEVICE_ATTRIBUTES_QUERY = "\x1b[c";

export class ProcessTerminal implements Terminal {
  private wasRaw = false;
  private inputHandler?: ((data: string) => void) | undefined;
  private resizeHandler?: (() => void) | undefined;
  #kittyProtocolActive = false;
  #modifyOtherKeysActive = false;
  private keyboardProtocolPushed = false;
  private pendingKeyboardProtocolDeviceAttributes = 0;
  private stdinBuffer?: StdinBuffer | undefined;
  private stdinDataHandler?: ((data: string) => void) | undefined;
  private readonly writeLog = new TerminalWriteLog();
  private readonly status = new TerminalStatusReporter();
  private readonly negotiationBuffer = new KeyboardNegotiationBuffer((sequence) =>
    this.forwardInputSequence(sequence),
  );

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
      if (this.status.handleReply(sequence)) return;
      const negotiation = this.negotiationBuffer.read(sequence);
      if (negotiation === "pending") {
        this.negotiationBuffer.scheduleFlush();
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
    this.negotiationBuffer.clear();
    const programStatusQuery = this.status.beginQuery();
    process.stdout.write(
      `${KITTY_KEYBOARD_PROTOCOL_QUERY}${programStatusQuery}${DEVICE_ATTRIBUTES_QUERY}`,
    );
    this.status.writeProgramStatus();
  }

  private handleKeyboardProtocolNegotiationSequence(
    negotiationSequence: KeyboardProtocolNegotiationSequence,
  ): boolean {
    this.negotiationBuffer.clear();
    if (negotiationSequence.type === "device-attributes") {
      if (this.pendingKeyboardProtocolDeviceAttributes === 0) return false;
      this.pendingKeyboardProtocolDeviceAttributes -= 1;
      if (this.pendingKeyboardProtocolDeviceAttributes === 0) this.status.endQuery();
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

  private popKeyboardProtocol(): void {
    const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this.#kittyProtocolActive;
    this.negotiationBuffer.clear();
    if (shouldDisableKittyProtocol) {
      process.stdout.write("\x1b[<u");
      this.keyboardProtocolPushed = false;
      this.#kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    this.disableModifyOtherKeys();
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
        this.popKeyboardProtocol();

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
    this.status.stop();
    process.stdout.write("\x1b[?2004l");
    this.popKeyboardProtocol();
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
    this.writeLog.append(data);
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
    this.status.setProgramStatus(status);
  }

  setProgress(active: boolean): void {
    this.status.setProgress(active);
  }
}
