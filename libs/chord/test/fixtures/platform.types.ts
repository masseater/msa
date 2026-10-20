import type { Duration } from "effect";

declare namespace platformTypes {
  interface NodeRun {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  interface NodeRunOptions {
    readonly timeout: Duration.Input;
    readonly cwd?: string;
  }
}

export type { platformTypes as default };
