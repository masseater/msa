import delay from "./delay.ts";
import type delayTypes from "./delay.types.ts";
import terminalProtocolModule from "./terminal-protocol.ts";
import type terminalProtocolTypes from "./terminal-protocol.types.ts";

const { runAfter } = delay;
const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;

type NegotiationRead =
  | { parsed: terminalProtocolTypes.KeyboardProtocolNegotiationSequence; sequence: string }
  | "pending"
  | undefined;

export default class KeyboardNegotiationBuffer {
  private buffer = "";
  private cancelFlush: delayTypes.CancelDelay | undefined;
  private readonly forward: (sequence: string) => void;

  constructor(forward: (sequence: string) => void) {
    this.forward = forward;
  }

  read(sequence: string): NegotiationRead {
    if (this.buffer !== "") {
      const bufferedSequence = this.buffer + sequence;
      const negotiationSequence =
        terminalProtocolModule.parseKeyboardProtocolNegotiationSequence(bufferedSequence);
      if (negotiationSequence !== undefined) {
        this.clear();
        return { parsed: negotiationSequence, sequence: bufferedSequence };
      }
      if (terminalProtocolModule.isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
        this.set(bufferedSequence);
        return "pending";
      }
      this.flushAsInput();
    }

    const negotiationSequence =
      terminalProtocolModule.parseKeyboardProtocolNegotiationSequence(sequence);
    if (negotiationSequence !== undefined) return { parsed: negotiationSequence, sequence };
    if (terminalProtocolModule.isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
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
