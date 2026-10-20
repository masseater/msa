import type source from "./source.ts";

declare namespace sourceTypes {
  interface CodemodeSourceOptions {
    maxOutputTokens?: number;
    timeoutMs?: number;
  }

  interface ParsedCodemodeSource {
    code: string;
    options: CodemodeSourceOptions;
  }

  type CodemodeSourceError = (typeof source.CodemodeSourceError)["prototype"];
}

export type { sourceTypes as default };
