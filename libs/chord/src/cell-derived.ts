import { dual } from "effect/Function";

import type cellSourceTypes from "./cell-source.types.ts";
import Derived from "./derived.ts";
import type typesModule from "./types.types.ts";

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
  changed: cellSourceTypes.Source<unknown>,
  value: unknown,
  validate = true,
): Map<Derived<unknown>, unknown> {
  const pending = new Set<Derived<unknown>>();
  const visit = (source: cellSourceTypes.Source<unknown>): void => {
    for (const derived of source.dependents) {
      if (pending.has(derived)) continue;
      pending.add(derived);
      visit(derived);
    }
  };
  visit(changed);
  const values = new Map<typesModule.Readable<unknown>, unknown>([[changed, value]]);
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

const sharesStructure: {
  (b: unknown): (a: unknown) => boolean;
  (a: unknown, b: unknown): boolean;
} = dual(2, structureShared);

const computeDependents: {
  (
    value: unknown,
    validate?: boolean,
  ): (changed: cellSourceTypes.Source<unknown>) => Map<Derived<unknown>, unknown>;
  (
    changed: cellSourceTypes.Source<unknown>,
    value: unknown,
    validate?: boolean,
  ): Map<Derived<unknown>, unknown>;
} = dual((args) => args.length >= 2, dependentsOf);

const cellDerived = {
  Derived,
  computeDependents,
  dependentsOf,
  sharesStructure,
};

export default cellDerived;
