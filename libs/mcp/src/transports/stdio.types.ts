import type StdioTransportClass from "./stdio.ts";

declare namespace stdioTypes {
  interface StdioTransportOptions {
    command: string;
    args?: readonly string[] | undefined;
    cwd?: string;
    env?: Record<string, string>;
    inheritEnv?: boolean;
    stderr?: "pipe" | "inherit";
    onStderr?: (chunk: string) => void;
    maxMessageBytes?: number;
    maxStderrBytes?: number;
    closeTimeoutMs?: number;
  }

  type StdioTransport = StdioTransportClass;
}

export type { stdioTypes as default };
