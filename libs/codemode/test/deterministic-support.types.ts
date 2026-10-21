import type codemodeTypes from "../src/index.types.ts";

declare namespace deterministicSupportTypes {
  type Create = (
    options?: codemodeTypes.CodemodeSandboxBaseOptions,
  ) => codemodeTypes.CodemodeSandboxBase;

  type Recorded = {
    run: codemodeTypes.CodemodeRun;
    calls: codemodeTypes.CodemodeHostCall[];
    idles: [seq: number, issued: number][];
    events: string[];
    fingerprint: () => string | undefined;
  };

  type StartOptions = Partial<codemodeTypes.CodemodeRunOptions> & {
    answer?: (call: codemodeTypes.CodemodeHostCall) => codemodeTypes.CodemodeOutcome;
  };
}

export type { deterministicSupportTypes as default };
