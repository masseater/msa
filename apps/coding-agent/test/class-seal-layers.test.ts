import { expect, it } from "vite-plus/test";

import classSealVariants from "./class-seal-variants.ts";

const { kinds, outcomesOf } = classSealVariants;

type Guard = Parameters<typeof outcomesOf>[0];

const beforeDefinition = [
  "shared-context-service",
  "shared-error-base",
  "shared-error-base-prototype",
  "shared-error-global",
  "shared-function-prototype",
  "shared-tui-container",
  "shared-tui-text-prototype",
  "shared-yieldable-error",
];

const afterDefinition = [
  "shared-after-error-base",
  "shared-after-factory-product",
  "shared-after-tui-prototype",
];

const fixtures = new Set([...beforeDefinition, ...afterDefinition].map((name) => `${name}.ts`));

const only = { fixture: (name: string) => fixtures.has(name), forms: false };

const unregistered = ["functionDeclaration", "functionExpression"];

const outcomes = (guard: Guard) => outcomesOf(guard, only);

const named = (names: readonly string[], selected: readonly string[]) =>
  names.flatMap((name) => selected.map((kind) => `fixture/${name}/${kind}`)).toSorted();

const where = (got: Readonly<Record<string, string>>, keep: (outcome: string) => boolean) =>
  Object.keys(got)
    .filter((name) => keep(got[name] ?? ""))
    .toSorted();

const stoppedAtWrite = new Set(["no-prototype", "not-extensible", "write-refused"]);

it("stops every write to a shared base at the write while the lock and the record are both on", () =>
  outcomes("sealed").then((got) => {
    expect(Object.keys(got)).toHaveLength(110);
    expect(where(got, (outcome) => !stoppedAtWrite.has(outcome))).toEqual([]);
    return undefined;
  }));

it("refuses every write made before the definition through the record alone, and leaves writes after it to the lock", () =>
  outcomes("without-lock").then((got) => {
    const before = named(beforeDefinition, Object.keys(kinds));
    expect(before.filter((name) => !["no-prototype", "refused"].includes(got[name] ?? ""))).toEqual(
      [],
    );
    const after = named(afterDefinition, Object.keys(kinds));
    expect(
      where(got, (outcome) => outcome === "reached").filter((name) => !after.includes(name)),
    ).toEqual([]);
    expect(named(afterDefinition, unregistered).filter((name) => got[name] !== "reached")).toEqual(
      [],
    );
    return undefined;
  }));

it("still stops every write at the write with the record off, through the lock", () =>
  outcomes("without-record").then((got) => {
    expect(where(got, (outcome) => !stoppedAtWrite.has(outcome))).toEqual([]);
    return undefined;
  }));

it("lets a local function reach the chain on every route once both are off", () =>
  outcomes("without-both").then((got) => {
    const reachable = named([...beforeDefinition, ...afterDefinition], unregistered);
    expect(reachable.filter((name) => got[name] !== "reached")).toEqual([]);
    return undefined;
  }));
