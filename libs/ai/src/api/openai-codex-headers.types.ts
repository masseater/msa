import type typesModule from "../types.types.ts";

declare namespace openaiCodexHeadersTypes {
  interface CodexCredentials {
    readonly modelHeaders: Record<string, string> | undefined;
    readonly optionHeaders: typesModule.ProviderHeaders | undefined;
    readonly accountId: string;
    readonly token: string;
  }
}

export type { openaiCodexHeadersTypes as default };
