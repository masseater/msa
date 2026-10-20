declare namespace cliInternalTypes {
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
