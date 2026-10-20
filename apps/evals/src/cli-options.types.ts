declare namespace cliOptionsTypes {
  type EvalCliOptions = {
    provider?: string | undefined;
    model?: string | undefined;
    runsPerVariant: number;
    requestedFiles: string[];
    discoveryArgs: string[];
  };
}

export type { cliOptionsTypes as default };
