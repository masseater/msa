import type SinceErrorClass from "./since-error.ts";

declare namespace autoSinceTypes {
  interface SinceFilter {
    readonly ms: number;
    readonly source: string;
  }

  type SinceError = SinceErrorClass;
}

export type { autoSinceTypes as default };
