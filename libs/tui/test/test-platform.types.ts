import type { Effect } from "effect";

declare namespace testPlatformTypes {
  interface CommandRequest {
    readonly file: string;
    readonly args: ReadonlyArray<string>;
    readonly env?: Record<string, string | undefined> | undefined;
    readonly input?: Uint8Array | undefined;
    readonly timeout?: number | undefined;
    readonly ignoreOutput?: boolean | undefined;
  }

  interface CommandOutput {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  interface ProcessRequest {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env?: Record<string, string | undefined> | undefined;
  }

  interface RunningProcess {
    readonly nextStdout: Effect.Effect<string>;
    readonly kill: (signal: "SIGKILL" | "SIGTERM") => Effect.Effect<void>;
    readonly close: Effect.Effect<void>;
  }
}

export type { testPlatformTypes as default };
