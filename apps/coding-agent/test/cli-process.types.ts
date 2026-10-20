import type { Duration } from "effect";

declare namespace cliProcessTypes {
  interface Options {
    readonly agentDir: string;
    readonly cwd: string;
    readonly offline?: boolean;
    readonly timeout?: Duration.Input;
  }

  interface Result {
    readonly code: number;
    readonly stderr: string;
    readonly stdout: string;
  }
}

export type { cliProcessTypes as default };
