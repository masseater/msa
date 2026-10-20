import type captureProcessModule from "./capture-process.ts";

declare namespace captureProcessTypes {
  interface ProcessOptions {
    readonly args: ReadonlyArray<string>;
    readonly command: string;
    readonly cwd: string;
  }

  interface CaptureResult {
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
  }

  type ProcessRunner = (typeof captureProcessModule.ProcessRunner)["prototype"];
}

export type { captureProcessTypes as default };
