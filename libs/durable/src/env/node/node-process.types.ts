import type { ChildProcess } from "node:child_process";

declare namespace nodeProcessTypes {
  type OsProcess = ChildProcess;

  interface SpawnRequest {
    readonly program: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly pipeStdin: boolean;
  }
}

export type { nodeProcessTypes as default };
