import type { TestContext } from "node:test";

declare namespace nativeClipboardLinuxHelpersTypes {
  interface ExecRequest {
    file: string;
    args: readonly string[];
    env: NodeJS.ProcessEnv;
    timeout?: number;
  }

  interface ServerRequest {
    t: TestContext;
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }

  interface ReaderResult {
    ok: boolean;
    value?: string | null;
    unavailable?: boolean;
    length?: number;
    hash?: string;
    error?: string;
  }

  interface CompiledFixtures {
    readonly directory: () => string;
  }
}

export type { nativeClipboardLinuxHelpersTypes as default };
