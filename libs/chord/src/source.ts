import type { TSchema } from "typebox";

import type cellDerivedTypes from "./cell-derived.types.ts";
import cellFanout from "./cell-fanout.ts";
import type cellFanoutTypes from "./cell-fanout.types.ts";
import type cellSourceTypes from "./cell-source.types.ts";
import schemaModule from "./schema.ts";
import type typesModule from "./types.types.ts";

const { Fanout, nextSequence } = cellFanout;
const { assertValid } = schemaModule;

export default abstract class Source<T> implements typesModule.Readable<T> {
  readonly key: string;
  readonly seq = nextSequence();
  readonly dependents = new Set<cellDerivedTypes.Derived<unknown>>();
  schemas: readonly TSchema[] = [];
  protected readonly options: cellSourceTypes.SourceOptions;
  protected readonly fanout: cellFanoutTypes.Fanout<T>;

  constructor(key: string, options: cellSourceTypes.SourceOptions) {
    this.key = key;
    this.options = options;
    this.fanout = new Fanout(options.report);
  }

  abstract get value(): T;

  subscribe(listener: (value: T) => void): () => void {
    return this.fanout.subscribe(listener, this.value);
  }

  events(listener: (event: typesModule.StateEvent<T>) => void): () => void {
    return this.fanout.events(listener, this.value);
  }

  validate(value: unknown): void {
    if (!this.options.dev) return;
    for (const schema of this.ownSchemas())
      assertValid("state", `state ${this.key}`, schema, value);
    for (const schema of this.schemas) assertValid("state", `state ${this.key}`, schema, value);
  }

  protected ownSchemas(): readonly TSchema[] {
    return [];
  }
}
