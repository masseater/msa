import type { TSchema } from "typebox";

import { computeDependents, type Derived, sharesStructure } from "./cell-derived.ts";
import { Source, type SourceOptions, type WriteGuard } from "./cell-source.ts";
import {
  type Draft,
  diffRevisions,
  type JsonValue,
  type Op,
  type Tracker,
  track,
} from "./delta/index.ts";
import { ChordError } from "./errors.ts";
import { holdPublications } from "./publish.ts";
import { assertValid } from "./schema.ts";
import type { Ctx } from "./types.ts";

export {
  HYDRATION,
  type Hydration,
  hydrationOf,
  Source,
  type SourceOptions,
  unhydrated,
  type WriteGuard,
} from "./cell-source.ts";
export {
  computeDependents,
  Derived,
  sharesStructure,
  type Sources,
  type SourceValues,
} from "./cell-derived.ts";

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

export const isSource = (value: unknown): value is Cell<unknown> | Derived<unknown> =>
  value instanceof Source;

export const notReady = (what: string): ChordError =>
  new ChordError("not_ready", `${what} is not ready`);
