declare namespace execTypes {
  interface ExecOptions {
    signal?: AbortSignal;
    timeout?: number;
    cwd?: string;
    env?: Readonly<Record<string, string>>;
  }

  interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
  }
}

export type { execTypes as default };
