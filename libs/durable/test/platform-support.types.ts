declare namespace platformSupportTypes {
  interface TempFile {
    readonly directory: string;
    readonly path: string;
  }

  interface CommandResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  interface CommandOptions {
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
  }
}

export type { platformSupportTypes as default };
