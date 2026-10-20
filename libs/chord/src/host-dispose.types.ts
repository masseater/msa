import type objectTypes from "./object.types.ts";

declare namespace hostDisposeTypes {
  interface Disposal {
    readonly objects: readonly objectTypes.ObjectImpl[];
    readonly reason: unknown;
    readonly message: string;
  }
}

export type { hostDisposeTypes as default };
