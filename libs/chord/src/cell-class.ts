import type { TSchema } from "typebox";

import type cellDerivedTypes from "./cell-derived.types.ts";
import cellKit from "./cell-kit.ts";
import type cellSourceTypes from "./cell-source.types.ts";
import cellModule from "./cell.ts";
import type deltaTypes from "./delta/index.types.ts";
import publish from "./publish.ts";
import schemaModule from "./schema.ts";
import type typesModule from "./types.types.ts";

const { cellDerived, cellSource, delta } = cellKit;
const { Source } = cellSource;
const { assertValid } = schemaModule;
const { diffRevisions, track } = delta;
const { computeDependents, sharesStructure } = cellDerived;
const { holdPublications } = publish;

interface Box<T> {
  v: T;
}

function unbox(ops: readonly deltaTypes.Op[], value: unknown): deltaTypes.Op[] {
  const result: deltaTypes.Op[] = [];
  for (const op of ops) {
    if (op[0] === "r" || op[1].length === 0) return [["r", value as deltaTypes.JsonValue]];
    const path = op[1].slice(1);
    switch (op[0]) {
      case "p":
        result.push(["p", path, op[2], op[3], op[4]]);
        break;
      case "m":
        result.push(["m", path, op[2]]);
        break;
      default:
        if (path.length === 0) return [["r", value as deltaTypes.JsonValue]];
        if (op[0] === "d") result.push(["d", path as [string | number, ...(string | number)[]]]);
        else
          result.push([
            op[0],
            path as [string | number, ...(string | number)[]],
            op[2],
          ] as deltaTypes.Op);
    }
  }
  return result;
}

export default class Cell<T> extends Source<T> {
  schema: TSchema;
  #tracker: deltaTypes.Tracker<Box<T>>;
  readonly #guard: cellSourceTypes.WriteGuard;
  #initialized: boolean;

  constructor(
    key: string,
    schema: TSchema,
    initial: { readonly value: T } | undefined,
    guard: cellSourceTypes.WriteGuard,
    options: cellSourceTypes.SourceOptions,
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
    if (!this.#initialized) throw cellModule.notReady(`state ${this.key} (its init has not run)`);
    return this.#tracker.value.v;
  }

  change(ctx: typesModule.Ctx, fn: (draft: deltaTypes.Draft<T>) => T): void;
  change(ctx: typesModule.Ctx, fn: (draft: deltaTypes.Draft<T>) => void): void;
  change(ctx: typesModule.Ctx, fn: (draft: deltaTypes.Draft<T>) => unknown): void {
    this.#guard(ctx);
    if (!this.#initialized) throw cellModule.notReady(`state ${this.key} (its init has not run)`);
    const change = this.#tracker.beginChange();
    let prepared: ReturnType<typeof change.prepare>;
    try {
      const draft = change.state as deltaTypes.Draft<Box<T>>;
      const result: unknown = fn(draft.v as deltaTypes.Draft<T>);
      if (result instanceof Promise)
        throw new TypeError("cell.change callbacks must be synchronous");
      if (result !== undefined) {
        if (result !== draft.v) assertValid("state", `state ${this.key}`, this.schema, result);
        draft.v = result as deltaTypes.Draft<T>;
      }
      prepared = change.prepare();
    } catch (error) {
      change.abort();
      throw error;
    }
    this.#publish(prepared, "ops");
  }

  replace(ctx: typesModule.Ctx, value: T, options: { readonly diff?: boolean } = {}): void {
    this.#guard(ctx);
    if (!this.#initialized) throw cellModule.notReady(`state ${this.key} (its init has not run)`);
    const before = this.value;
    const diff = options.diff ?? sharesStructure(before, value);
    const ops = diff
      ? diffRevisions(before as deltaTypes.JsonValue, value as deltaTypes.JsonValue)
      : undefined;
    this.#publish(this.#tracker.prepareReplace({ v: value }), "ops", true, ops);
  }

  reset(value: T, schema: TSchema): void {
    this.schema = schema;
    this.#publish(this.#tracker.prepareReplace({ v: value }), "reset", false);
  }

  #publish(
    prepared: ReturnType<deltaTypes.Tracker<Box<T>>["prepareReplace"]>,
    type: "ops" | "reset",
    validate = true,
    ops?: readonly deltaTypes.Op[],
  ): void {
    if (prepared.ops.length === 0 && type === "ops") {
      this.#tracker.adopt(prepared);
      return;
    }
    const value = prepared.value.v;
    let candidates: Map<cellDerivedTypes.Derived<unknown>, unknown>;
    try {
      if (validate) this.validate(value);
      candidates = computeDependents(this as cellSourceTypes.Source<unknown>, value, validate);
    } catch (error) {
      prepared.abort();
      throw error;
    }
    holdPublications(() => {
      this.#tracker.adopt(prepared);
      const published = ops !== undefined && ops.length > 0 ? ops : unbox(prepared.ops, value);
      this.fanout.emit(type === "reset" ? { type, value } : { ops: published, type, value });
      for (const [derived, next] of candidates) derived.install(next);
    });
  }
}
