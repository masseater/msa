declare namespace mcpFakeServerTypes {
  interface Options {
    listTools?: (() => unknown[]) | undefined;
    resources?: boolean | undefined;
    instructions?: string | undefined;
    initializeDelayMs?: number | undefined;
  }
}

export type { mcpFakeServerTypes as default };
