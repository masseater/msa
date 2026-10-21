import type cliTypes from "./cli.types.ts";
import type configTypes from "./config.types.ts";
import type runtimeTypes from "./runtime.types.ts";

declare namespace cliInternalTypes {
  interface CommandContext {
    options: cliTypes.McpCommandOptions;
    loaded: configTypes.LoadedMcpConfig;
    untrustedNote: string | undefined;
    credentials: runtimeTypes.McpOAuthCredentialStore;
    log: (line: string) => void;
    error: (line: string) => void;
  }

  interface ServerReport {
    name: string;
    scope: string;
    source: string;

    override?: string;
    enabled: boolean;
    exposure: string;
    transport: string;
    state: string;
    tools: string[];

    toolExposure?: Record<string, string>;

    resources?: true;
    error?: string;
  }

  interface ParsedOptions {
    positional: string[];
    values: Map<string, string | true>;

    lists: Map<string, string[]>;
  }
}

export type { cliInternalTypes as default };
