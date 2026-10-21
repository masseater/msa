declare namespace tregTypes {
  interface TregRun {
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }

  type TregRunner = (args: string[], signal?: AbortSignal) => Promise<TregRun>;

  interface TregOptions {
    run: TregRunner;
  }

  interface TregResult {
    output: Readonly<Record<string, unknown>>;
    servedBy?: string;
    costMicro?: number;
  }

  interface TregSignInPage {
    url: string;
    code?: string;
  }
}

export type { tregTypes as default };
