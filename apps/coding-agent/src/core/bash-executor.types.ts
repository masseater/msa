declare namespace bashExecutorTypes {
  interface BashExecutorOptions {
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  }

  interface BashResult {
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string | undefined;
  }
}

export type { bashExecutorTypes as default };
