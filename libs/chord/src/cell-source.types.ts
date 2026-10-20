import type cellSource from "./cell-source.ts";
import type typesModule from "./types.types.ts";

declare namespace cellSourceTypes {
  interface SourceOptions {
    readonly dev: boolean;
    readonly report: (error: unknown) => void;
  }

  type WriteGuard = (ctx: typesModule.Ctx) => void;

  interface Hydration {
    readonly hydrated: boolean;
    whenHydrated(): Promise<void>;
  }

  type Source<T> = (typeof cellSource.Source<T>)["prototype"];
}

export type { cellSourceTypes as default };
