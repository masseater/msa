import { dual } from "effect/Function";

import {
  HYDRATION,
  type Hydration,
  Source,
  type SourceOptions,
  unhydrated,
} from "./cell-source.ts";
import { diffRevisions, type JsonValue, type Op } from "./delta/index.ts";
import { holdPublications } from "./publish.ts";
import type { Readable } from "./types.ts";

function structureShared(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || a === b)
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  for (const [key, child] of Object.entries(b)) {
    if (
      child !== null &&
      typeof child === "object" &&
      (a as Record<string, unknown>)[key] === child
    )
      return true;
  }
  return false;
}

function dependentsOf(
  changed: Source<unknown>,
  value: unknown,
  validate = true,
): Map<Derived<unknown>, unknown> {
  const pending = new Set<Derived<unknown>>();
  const visit = (source: Source<unknown>): void => {
    for (const derived of source.dependents) {
      if (pending.has(derived)) continue;
      pending.add(derived);
      visit(derived);
    }
  };
  visit(changed);
  const values = new Map<Readable<unknown>, unknown>([[changed, value]]);
  const result = new Map<Derived<unknown>, unknown>();
  for (const derived of [...pending].sort((a, b) => a.seq - b.seq)) {
    const next = derived.compute((source) =>
      values.has(source) ? values.get(source) : source.value,
    );
    if (validate) derived.validate(next);
    values.set(derived, next);
    result.set(derived, next);
  }
  return result;
}

export type Sources = readonly Readable<unknown>[];
export type SourceValues<S extends Sources> = {
  [K in keyof S]: S[K] extends Readable<infer T> ? T : never;
};

const isReadable = (value: unknown): value is Readable<unknown> =>
  value !== null &&
  typeof value === "object" &&
  typeof (value as Readable<unknown>).subscribe === "function" &&
  "value" in value;

export class Derived<T> extends Source<T> {
  readonly sources: readonly Readable<unknown>[];
  readonly #fn: (...values: never[]) => unknown;
  #value: T;
  #external: (() => void)[] = [];

  constructor(
    key: string,
    sources: Sources,
    fn: (...values: never[]) => unknown,
    options: SourceOptions,
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

  get [HYDRATION](): Hydration | undefined {
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

  compute(read: (source: Readable<unknown>) => unknown): T {
    const result: unknown = this.#fn(...(this.sources.map(read) as never[]));
    if (result instanceof Promise)
      throw new TypeError(`derive ${this.key}: fn must be synchronous`);
    return result as T;
  }

  refresh(): void {
    try {
      const next = this.compute((source) => source.value);
      const dependents = dependentsOf(this as Derived<unknown>, next);
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
    const ops: Op[] =
      before === undefined || next === undefined
        ? [["r", (next ?? null) as JsonValue]]
        : diffRevisions(before as JsonValue, next as JsonValue);
    if (ops.length > 0) this.fanout.emit({ type: "ops", ops, value: next });
  }
}

export const sharesStructure: {
  (b: unknown): (a: unknown) => boolean;
  (a: unknown, b: unknown): boolean;
} = dual(2, structureShared);

export const computeDependents: {
  (
    value: unknown,
    validate?: boolean,
  ): (changed: Source<unknown>) => Map<Derived<unknown>, unknown>;
  (changed: Source<unknown>, value: unknown, validate?: boolean): Map<Derived<unknown>, unknown>;
} = dual((args) => args.length >= 2, dependentsOf);
