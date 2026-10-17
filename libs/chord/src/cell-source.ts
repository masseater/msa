import type { TSchema } from "typebox";

import type { Derived } from "./cell-derived.ts";
import { Fanout, nextSequence } from "./cell-fanout.ts";
import { assertValid } from "./schema.ts";
import type { Ctx, Readable, StateEvent } from "./types.ts";

export interface SourceOptions {
  readonly dev: boolean;
  readonly report: (error: unknown) => void;
}

export type WriteGuard = (ctx: Ctx) => void;

export const HYDRATION: unique symbol = Symbol("chord.hydration");

export interface Hydration {
  readonly hydrated: boolean;
  whenHydrated(): Promise<void>;
}

export function hydrationOf(value: unknown): Hydration | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return (value as { readonly [HYDRATION]?: Hydration })[HYDRATION];
}

export const unhydrated = (sources: Iterable<unknown>): Hydration[] =>
  [...sources]
    .map(hydrationOf)
    .filter((hydration): hydration is Hydration => hydration?.hydrated === false);

export abstract class Source<T> implements Readable<T> {
  readonly key: string;
  readonly seq = nextSequence();
  readonly dependents = new Set<Derived<unknown>>();
  schemas: readonly TSchema[] = [];
  protected readonly options: SourceOptions;
  protected readonly fanout: Fanout<T>;

  constructor(key: string, options: SourceOptions) {
    this.key = key;
    this.options = options;
    this.fanout = new Fanout(options.report);
  }

  abstract get value(): T;

  subscribe(listener: (value: T) => void): () => void {
    return this.fanout.subscribe(listener, this.value);
  }

  events(listener: (event: StateEvent<T>) => void): () => void {
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
