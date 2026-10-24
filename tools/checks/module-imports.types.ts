import type { Effect } from "effect";

declare namespace moduleImportsTypes {
  interface ModuleImports {
    readonly embedded: ReadonlyArray<string>;
    readonly specs: ReadonlyArray<string>;
  }

  type ReadImports = (file: string, text: string) => Effect.Effect<ModuleImports, string>;
}

export type { moduleImportsTypes as default };
