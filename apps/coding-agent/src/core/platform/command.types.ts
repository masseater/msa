declare namespace commandTypes {
  interface CommandRequest {
    readonly file: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly input?: string;
  }

  interface CommandOutput {
    readonly lines: ReadonlyArray<string>;
    readonly stderr: string;
    readonly exitCode: number;
  }

  interface StreamRequest extends CommandRequest {
    readonly onLine: (line: string) => boolean;
  }

  interface StreamOutput {
    readonly stoppedEarly: boolean;
    readonly stderr: string;
    readonly exitCode: number | undefined;
  }
}

export type { commandTypes as default };
