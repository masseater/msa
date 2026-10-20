import type {
  CodemodeHostCall,
  CodemodeOutcome,
  CodemodeRun,
  CodemodeRunOptions,
  CodemodeSandboxBase,
  CodemodeSandboxBaseOptions,
} from "../src/index.ts";

declare namespace deterministicSupportTypes {
  type Create = (options?: CodemodeSandboxBaseOptions) => CodemodeSandboxBase;

  type Recorded = {
    run: CodemodeRun;
    calls: CodemodeHostCall[];
    idles: [seq: number, issued: number][];
    events: string[];
    fingerprint: () => string | undefined;
  };

  type StartOptions = Partial<CodemodeRunOptions> & {
    answer?: (call: CodemodeHostCall) => CodemodeOutcome;
  };
}

export type { deterministicSupportTypes as default };
