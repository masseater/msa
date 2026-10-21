import type runtimeTypes from "./runtime.types.ts";

declare namespace cliTypes {
  interface McpCommandOptions {
    cwd: string;
    agentDir: string;

    credentials?: runtimeTypes.McpOAuthCredentialStore;

    openUrl?: (url: string) => void;

    log?: (line: string) => void;
    error?: (line: string) => void;
  }
}

export type { cliTypes as default };
