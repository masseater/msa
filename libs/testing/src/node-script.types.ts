import type { Duration } from "effect";

declare namespace nodeScriptTypes {
  interface Options {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly nodeArgs?: readonly string[];
    readonly scriptArgs?: readonly string[];
    readonly timeout?: Duration.Input;
  }

  interface Result {
    readonly code: number;
    readonly elapsedMs: number;
    readonly stderr: string;
    readonly stdout: string;
  }
}

export type { nodeScriptTypes as default };
