import { EventEmitter } from "events";

import delay from "./delay.ts";
import type delayTypes from "./delay.types.ts";
import type stdinBufferTypes from "./stdin-buffer.types.ts";
import stdinSequences from "./stdin-sequences.ts";

const {
  ESC,
  extractCompleteSequences,
  isControlString,
  parseUnmodifiedKittyPrintableCodepoint,
  startsWithTerminalReplyHeader,
} = stdinSequences;
const { runAfter } = delay;

const DEFAULT_SEQUENCE_TIMEOUT_MS = 50;
const DEFAULT_ESCAPE_TIMEOUT_MS = 10;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

function decodeInput(data: string | Buffer): string {
  if (!Buffer.isBuffer(data)) {
    return data;
  }
  if (data.length === 1 && data[0]! > 127) {
    const byte = data[0]! - 128;
    return `\x1b${String.fromCharCode(byte)}`;
  }
  return data.toString();
}

export default class StdinBuffer extends EventEmitter<stdinBufferTypes.StdinBufferEventMap> {
  private buffer: string = "";
  private cancelTimeout: delayTypes.CancelDelay | null = null;
  private readonly timeoutMs: number;
  private readonly escapeTimeoutMs: number;
  private pasteMode: boolean = false;
  private pasteBuffer: string = "";
  private pendingKittyPrintableCodepoint: number | undefined;

  constructor(options: stdinBufferTypes.StdinBufferOptions = {}) {
    super();
    this.timeoutMs = options.timeout ?? DEFAULT_SEQUENCE_TIMEOUT_MS;
    this.escapeTimeoutMs = options.escapeTimeout ?? DEFAULT_ESCAPE_TIMEOUT_MS;
  }

  public process(data: string | Buffer): void {
    this.cancelPendingTimeout();

    const str = decodeInput(data);
    if (str.length === 0 && this.buffer.length === 0) {
      this.emitDataSequence("");
      return;
    }

    this.buffer += str;

    if (this.pasteMode) {
      this.pasteBuffer += this.buffer;
      this.buffer = "";
      this.finishPasteIfComplete();
      return;
    }

    const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
    if (startIndex !== -1) {
      this.startPaste(startIndex);
      return;
    }

    this.processSequences();
  }

  private startPaste(startIndex: number): void {
    if (startIndex > 0) {
      const result = extractCompleteSequences(this.buffer.slice(0, startIndex));
      for (const sequence of result.sequences) {
        this.emitDataSequence(sequence);
      }
    }

    this.pendingKittyPrintableCodepoint = undefined;
    this.pasteMode = true;
    this.pasteBuffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
    this.buffer = "";
    this.finishPasteIfComplete();
  }

  private finishPasteIfComplete(): void {
    const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
    if (endIndex === -1) {
      return;
    }
    const pastedContent = this.pasteBuffer.slice(0, endIndex);
    const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);

    this.pasteMode = false;
    this.pasteBuffer = "";
    this.pendingKittyPrintableCodepoint = undefined;

    this.emit("paste", pastedContent);

    if (remaining.length > 0) {
      this.process(remaining);
    }
  }

  private processSequences(): void {
    const result = extractCompleteSequences(this.buffer);
    this.buffer = result.remainder;

    for (const sequence of result.sequences) {
      this.emitDataSequence(sequence);
    }

    if (this.buffer.length === 0 || startsWithTerminalReplyHeader(this.buffer)) {
      return;
    }
    const timeoutMs = this.buffer === ESC ? this.escapeTimeoutMs : this.timeoutMs;
    this.cancelTimeout = runAfter(timeoutMs, () => this.flushPending());
  }

  private flushPending(): void {
    for (const sequence of this.flush()) {
      if (sequence.length > 2 && isControlString(sequence)) {
        this.emitDataSequence(sequence.slice(0, 2));
        this.process(sequence.slice(2));
      } else {
        this.emitDataSequence(sequence);
      }
    }
  }

  private emitDataSequence(sequence: string): void {
    const rawCodepoint = sequence.length === 1 ? sequence.codePointAt(0) : undefined;
    if (rawCodepoint !== undefined && rawCodepoint === this.pendingKittyPrintableCodepoint) {
      this.pendingKittyPrintableCodepoint = undefined;
      return;
    }

    this.pendingKittyPrintableCodepoint = parseUnmodifiedKittyPrintableCodepoint(sequence);
    this.emit("data", sequence);
  }

  private cancelPendingTimeout(): void {
    if (this.cancelTimeout !== null) {
      this.cancelTimeout();
      this.cancelTimeout = null;
    }
  }

  flush(): string[] {
    this.cancelPendingTimeout();

    if (this.buffer.length === 0) {
      return [];
    }

    const sequences = [this.buffer];
    this.buffer = "";
    this.pendingKittyPrintableCodepoint = undefined;
    return sequences;
  }

  clear(): void {
    this.cancelPendingTimeout();
    this.buffer = "";
    this.pasteMode = false;
    this.pasteBuffer = "";
    this.pendingKittyPrintableCodepoint = undefined;
  }

  getBuffer(): string {
    return this.buffer;
  }

  destroy(): void {
    this.clear();
  }
}
