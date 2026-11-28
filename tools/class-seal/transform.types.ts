import type { SourceMap } from "magic-string";

declare namespace classSealTransformTypes {
  type Sealed = { readonly code: string; readonly map: SourceMap };

  type Target = {
    readonly filename: string;
    readonly module: string;
    readonly runtime: string;
    readonly shared: string;
  };
}

export type { classSealTransformTypes as default };
