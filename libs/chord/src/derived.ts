import cellDerivedModule from "./cell-derived.ts";
import type cellDerivedTypes from "./cell-derived.types.ts";
import cellSource from "./cell-source.ts";
import type cellSourceTypes from "./cell-source.types.ts";
import delta from "./delta/index.ts";
import type deltaTypes from "./delta/index.types.ts";
import publish from "./publish.ts";
import type typesModule from "./types.types.ts";

const { HYDRATION, Source, unhydrated } = cellSource;
const { holdPublications } = publish;
const { diffRevisions } = delta;
const isReadable = (value: unknown): value is typesModule.Readable<unknown> =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as typesModule.Readable<unknown>).subscribe === "function" &&
  "value" in value;

export default class Derived<T> extends Source<T> {
  readonly sources: readonly typesModule.Readable<unknown>[];
  readonly #fn: (...values: never[]) => unknown;
  #value: T;
  #external: (() => void)[] = [];

  constructor(
    key: string,
    sources: cellDerivedTypes.Sources,
    fn: (...values: never[]) => unknown,
    options: cellSourceTypes.SourceOptions,
  ) {
    super(key, options);
    this.sources = sources.map((source) => {
      if (!isReadable(source)) throw new TypeError(`derive ${key}: sources must be readables`);
      return source;
    });
    this.#fn = fn;
    this.#value = undefined as T;
  }

  get value(): T {
    return this.#value;
  }

  get [HYDRATION](): cellSourceTypes.Hydration | undefined {
    const pending = unhydrated(this.sources);
    if (pending.length === 0) return undefined;
    return {
      hydrated: false,
      whenHydrated: () =>
        Promise.all(pending.map((hydration) => hydration.whenHydrated())).then(() => undefined),
    };
  }

  attach(precomputed?: ReadonlyMap<unknown, unknown>): void {
    this.#value =
      precomputed?.has(this) === true
        ? (precomputed.get(this) as T)
        : this.compute((source) => source.value);
    for (const source of this.sources) {
      if (source instanceof Source) source.dependents.add(this as Derived<unknown>);
      else this.#external.push(source.subscribe(() => this.refresh()));
    }
  }

  detach(): void {
    for (const source of this.sources)
      if (source instanceof Source) source.dependents.delete(this as Derived<unknown>);
    for (const unsubscribe of this.#external.splice(0)) unsubscribe();
  }

  compute(read: (source: typesModule.Readable<unknown>) => unknown): T {
    const result: unknown = this.#fn(...(this.sources.map(read) as never[]));
    if (result instanceof Promise)
      throw new TypeError(`derive ${this.key}: fn must be synchronous`);
    return result as T;
  }

  refresh(): void {
    try {
      const next = this.compute((source) => source.value);
      const dependents = cellDerivedModule.dependentsOf(this as Derived<unknown>, next);
      holdPublications(() => {
        this.install(next);
        for (const [derived, value] of dependents) derived.install(value);
      });
    } catch (error) {
      this.options.report(error);
    }
  }

  install(next: T): void {
    const before = this.#value;
    this.#value = next;
    const ops: deltaTypes.Op[] =
      before === undefined || next === undefined
        ? [["r", (next ?? null) as deltaTypes.JsonValue]]
        : diffRevisions(before as deltaTypes.JsonValue, next as deltaTypes.JsonValue);
    if (ops.length > 0) this.fanout.emit({ ops, type: "ops", value: next });
  }
}
