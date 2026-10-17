import type { TSchema } from "typebox";

import {
  type Draft,
  diffRevisions,
  type JsonValue,
  type Op,
  type Tracker,
  track,
} from "./delta/index.ts";
import { ChordError } from "./errors.ts";
import { enqueue, holdPublications } from "./publish.ts";
import { assertValid } from "./schema.ts";
import type { Ctx, Readable, StateEvent } from "./types.ts";

export interface SourceOptions {
  readonly dev: boolean;
  readonly report: (error: unknown) => void;
}

export type WriteGuard = (ctx: Ctx) => void;

let sequence = 0;

class Fanout<T> {
  readonly #values = new Set<(value: T) => void>();
  readonly #events = new Set<(event: StateEvent<T>) => void>();
  readonly #report: (error: unknown) => void;

  constructor(report: (error: unknown) => void) {
    this.#report = report;
  }

  subscribe(listener: (value: T) => void, current: T): () => void {
    this.#values.add(listener);
    this.#call(listener, current);
    return () => this.#values.delete(listener);
  }

  events(listener: (event: StateEvent<T>) => void, current: T): () => void {
    this.#events.add(listener);
    this.#call(listener, { type: "snap", value: current });
    return () => this.#events.delete(listener);
  }

  emit(event: StateEvent<T>): void {
    const events = [...this.#events];
    const values = [...this.#values];
    enqueue(() => {
      for (const listener of events) if (this.#events.has(listener)) this.#call(listener, event);
      for (const listener of values)
        if (this.#values.has(listener)) this.#call(listener, event.value);
    });
  }

  #call<V>(listener: (value: V) => void, value: V): void {
    try {
      listener(value);
    } catch (error) {
      this.#report(error);
    }
  }
}

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
  readonly seq = ++sequence;
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

interface Box<T> {
  v: T;
}

function unbox(ops: readonly Op[], value: unknown): Op[] {
  const result: Op[] = [];
  for (const op of ops) {
    if (op[0] === "r" || op[1].length === 0) return [["r", value as JsonValue]];
    const path = op[1].slice(1);
    switch (op[0]) {
      case "p":
        result.push(["p", path, op[2], op[3], op[4]]);
        break;
      case "m":
        result.push(["m", path, op[2]]);
        break;
      default:
        if (path.length === 0) return [["r", value as JsonValue]];
        if (op[0] === "d") result.push(["d", path as [string | number, ...(string | number)[]]]);
        else result.push([op[0], path as [string | number, ...(string | number)[]], op[2]] as Op);
    }
  }
  return result;
}

export class Cell<T> extends Source<T> {
  schema: TSchema;
  #tracker: Tracker<Box<T>>;
  readonly #guard: WriteGuard;
  #initialized: boolean;

  constructor(
    key: string,
    schema: TSchema,
    initial: { readonly value: T } | undefined,
    guard: WriteGuard,
    options: SourceOptions,
  ) {
    super(key, options);
    if (initial !== undefined)
      assertValid("state", `initial value of state ${key}`, schema, initial.value);
    this.schema = schema;
    this.#tracker = track<Box<T>>({ v: (initial?.value ?? null) as T });
    this.#guard = guard;
    this.#initialized = initial !== undefined;
  }

  initialize(value: T): void {
    if (this.#initialized) throw new Error(`state ${this.key} is already initialized`);
    assertValid("state", `initial value of state ${this.key}`, this.schema, value);
    this.#tracker = track<Box<T>>({ v: value });
    this.#initialized = true;
  }

  protected override ownSchemas(): readonly TSchema[] {
    return [this.schema];
  }

  get value(): T {
    if (!this.#initialized) throw notReady(`state ${this.key} (its init has not run)`);
    return this.#tracker.value.v;
  }

  change(ctx: Ctx, fn: (draft: Draft<T>) => T): void;
  change(ctx: Ctx, fn: (draft: Draft<T>) => void): void;
  change(ctx: Ctx, fn: (draft: Draft<T>) => unknown): void {
    this.#guard(ctx);
    if (!this.#initialized) throw notReady(`state ${this.key} (its init has not run)`);
    const change = this.#tracker.beginChange();
    let prepared: ReturnType<typeof change.prepare>;
    try {
      const draft = change.state as Draft<Box<T>>;
      const result: unknown = fn(draft.v as Draft<T>);
      if (result instanceof Promise)
        throw new TypeError("cell.change callbacks must be synchronous");
      if (result !== undefined) {
        if (result !== draft.v) assertValid("state", `state ${this.key}`, this.schema, result);
        draft.v = result as Draft<T>;
      }
      prepared = change.prepare();
    } catch (error) {
      change.abort();
      throw error;
    }
    this.#publish(prepared, "ops");
  }

  replace(ctx: Ctx, value: T, options: { readonly diff?: boolean } = {}): void {
    this.#guard(ctx);
    if (!this.#initialized) throw notReady(`state ${this.key} (its init has not run)`);
    const before = this.value;
    const diff = options.diff ?? sharesStructure(before, value);
    const ops = diff ? diffRevisions(before as JsonValue, value as JsonValue) : undefined;
    this.#publish(this.#tracker.prepareReplace({ v: value }), "ops", true, ops);
  }

  reset(value: T, schema: TSchema): void {
    this.schema = schema;
    this.#publish(this.#tracker.prepareReplace({ v: value }), "reset", false);
  }

  #publish(
    prepared: ReturnType<Tracker<Box<T>>["prepareReplace"]>,
    type: "ops" | "reset",
    validate = true,
    ops?: readonly Op[],
  ): void {
    if (prepared.ops.length === 0 && type === "ops") {
      this.#tracker.adopt(prepared);
      return;
    }
    const value = prepared.value.v;
    let candidates: Map<Derived<unknown>, unknown>;
    try {
      if (validate) this.validate(value);
      candidates = computeDependents(this as Source<unknown>, value, validate);
    } catch (error) {
      prepared.abort();
      throw error;
    }
    holdPublications(() => {
      this.#tracker.adopt(prepared);
      const published = ops !== undefined && ops.length > 0 ? ops : unbox(prepared.ops, value);
      this.fanout.emit(type === "reset" ? { type, value } : { type, ops: published, value });
      for (const [derived, next] of candidates) derived.install(next);
    });
  }
}

function sharesStructure(a: unknown, b: unknown): boolean {
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

function computeDependents(
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
        Promise.all(pending.map((hydration) => hydration.whenHydrated())).then(() => {}),
    };
  }

  attach(precomputed?: ReadonlyMap<unknown, unknown>): void {
    this.#value = precomputed?.has(this)
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
      const dependents = computeDependents(this as Derived<unknown>, next);
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

export const isSource = (value: unknown): value is Cell<unknown> | Derived<unknown> =>
  value instanceof Source;

export const notReady = (what: string): ChordError =>
  new ChordError("not_ready", `${what} is not ready`);
