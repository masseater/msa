import type testProcess from "./test-process.ts";

declare namespace testProcessTypes {
  interface ProcessOptions {
    readonly args: ReadonlyArray<string>;
    readonly command: string;
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>> | undefined;
  }

  interface CaptureResult {
    readonly exitCode: number;
    readonly stderr: string;
    readonly stdout: string;
  }

  type ProcessRunner = (typeof testProcess.ProcessRunner)["prototype"];
}

export type { testProcessTypes as default };
