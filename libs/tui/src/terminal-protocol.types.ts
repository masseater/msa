import type programStatusTypes from "./program-status.types.ts";
import type terminalProtocol from "./terminal-protocol.ts";

declare namespace terminalProtocolTypes {
  type KeyboardProtocolNegotiationSequence =
    | { type: "kitty-flags"; flags: number }
    | { type: "device-attributes" };

  interface Terminal {
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

    setProgramStatus(status: programStatusTypes.ProgramStatus): void;
  }

  type KeyboardNegotiationBuffer = (typeof terminalProtocol.KeyboardNegotiationBuffer)["prototype"];
}

export type { terminalProtocolTypes as default };
