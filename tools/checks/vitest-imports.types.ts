import type { Effect } from "effect";

declare namespace vitestImportsTypes {
  interface Imports {
    readonly embedded: ReadonlyArray<string>;
    readonly problems: ReadonlyArray<string>;
    readonly specs: ReadonlyArray<string>;
  }

  interface Options {
    readonly childProblems: (file: string, text: string) => Effect.Effect<ReadonlyArray<string>>;
    readonly cwd: string;
    readonly isWorkspaceSpec: (spec: string) => boolean;
    readonly projects: ReadonlyArray<string>;
    readonly readText: (file: string) => Effect.Effect<string>;
    readonly relative: (file: string) => string;
    readonly root: string;
    readonly importsOf: (file: string, text: string) => Effect.Effect<Imports>;
  }
}

export type { vitestImportsTypes as default };
