declare namespace bashOperationsTypes {
  interface BashOperations {
    exec: (
      command: string,
      cwd: string,
      options: {
        onData: (data: Buffer) => void;
        signal?: AbortSignal | undefined;
        timeout?: number | undefined;
        env?: NodeJS.ProcessEnv | undefined;
      },
    ) => Promise<{ exitCode: number | null }>;
  }

  type ExecuteOptions = Parameters<BashOperations["exec"]>[2];
}

export type { bashOperationsTypes as default };
