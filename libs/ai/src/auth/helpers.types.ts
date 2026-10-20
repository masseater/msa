import type typesModule from "./types.ts";
declare namespace helpersTypes {
  interface AuthEnvSource {
    readonly ctx: typesModule.AuthContext;
    readonly signal: AbortSignal;
  }
}

export type { helpersTypes as default };
