import type terminal from "./terminal.ts";

declare namespace terminalTypes {
  interface TerminalOptions {
    cwd: string;
    argv?: readonly string[];
    env?: Record<string, string>;
    inheritEnv?: boolean;
    cols: number;
    rows: number;
    onData: (bytes: Uint8Array) => void;
  }

  interface TerminalForeground {
    pid: number;
    name?: string;
  }

  type RemoteTerminal = (typeof terminal.RemoteTerminal)["prototype"];
}

export type { terminalTypes as default };
