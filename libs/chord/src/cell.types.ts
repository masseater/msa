import type cellDerivedTypes from "./cell-derived.types.ts";
import type cellSourceTypes from "./cell-source.types.ts";
import type cell from "./cell.ts";

declare namespace cellTypes {
  type Hydration = cellSourceTypes.Hydration;

  type SourceOptions = cellSourceTypes.SourceOptions;

  type WriteGuard = cellSourceTypes.WriteGuard;

  type Sources = cellDerivedTypes.Sources;

  type SourceValues<S extends Sources> = cellDerivedTypes.SourceValues<S>;

  type Source<T> = cellSourceTypes.Source<T>;

  type Derived<T> = cellDerivedTypes.Derived<T>;

  type Cell<T> = InstanceType<typeof cell.Cell<T>>;
}

export type { cellTypes as default };
