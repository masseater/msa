import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import classFactories from "../oxlint/class-factories.ts";
import classMarker from "./class-marker.ts";

const { createMarker } = classMarker;

type Snapshot = {
  readonly descriptors: readonly (readonly [PropertyKey, PropertyDescriptor])[];
  readonly prototype: object | null;
};

const snapshot = (value: object): Snapshot => ({
  descriptors: Reflect.ownKeys(value).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(value, key)!,
  ]),
  prototype: Object.getPrototypeOf(value),
});

const chainOf = (value: unknown): readonly unknown[] => {
  const links: unknown[] = [];
  for (
    let link: unknown = value;
    (typeof link === "object" || typeof link === "function") && link !== null;
    link = Object.getPrototypeOf(link)
  )
    links.push(link);
  return links;
};

const chainsReachable = (value: unknown): readonly unknown[] => {
  if (typeof value === "function")
    return [...chainOf(value), ...chainOf((value as { prototype?: unknown }).prototype)];
  return chainOf(value);
};

type Probe = (marker: unknown) => readonly unknown[];

const factoryProbes: Readonly<Record<string, Probe>> = {
  "effect/Context/Service": (marker) => [
    Context.Service()(marker as never),
    Context.Service()("Tag"),
  ],
  "effect/Data/TaggedError": (marker) => [Data.TaggedError(marker as never)],
  "effect/Schema/TaggedError": (marker) => [
    Schema.TaggedError()("Tag", { field: marker as never }),
    Schema.TaggedError()("Tag", { nested: Schema.Struct({ field: marker as never }) }),
    Schema.TaggedError()(marker as never, {}),
  ],
};

const run = (probe: Probe) => {
  const marker = createMarker();
  const before = {
    marker: snapshot(marker),
    markerPrototype: snapshot(marker.prototype),
    namespaces: [Schema, Data, Context].map((namespace) => snapshot(namespace)),
  };
  let results: readonly unknown[] = [];
  let threw = false;
  try {
    results = probe(marker);
  } catch {
    threw = true;
  }
  const subclasses = results
    .filter((result): result is new () => object => typeof result === "function")
    .map((Result) => class extends Result {});
  const reached = [...results, ...subclasses]
    .flatMap(chainsReachable)
    .some((link) => link === marker || link === marker.prototype);
  return {
    argumentUnchanged:
      JSON.stringify(snapshot(marker)) === JSON.stringify(before.marker) &&
      Object.getPrototypeOf(marker) === before.marker.prototype &&
      Object.getPrototypeOf(marker.prototype) === before.markerPrototype.prototype,
    namespacesUnchanged: [Schema, Data, Context].every(
      (namespace, index) =>
        JSON.stringify(snapshot(namespace).descriptors.map(([key]) => String(key))) ===
        JSON.stringify(before.namespaces[index]!.descriptors.map(([key]) => String(key))),
    ),
    reached,
    threw,
  };
};

it("every listed factory keeps a marker class out of the returned chains and leaves its arguments alone", () => {
  const probes = factoryProbes;
  expect(Object.keys(probes).toSorted()).toEqual([...classFactories.keys()].toSorted());
  const outcomes = Object.fromEntries(
    Object.entries(probes).map(([key, probe]) => {
      const { argumentUnchanged, namespacesUnchanged, reached } = run(probe);
      return [key, { argumentUnchanged, namespacesUnchanged, reached }];
    }),
  );
  expect(outcomes).toEqual(
    Object.fromEntries(
      Object.keys(probes).map((key) => [
        key,
        { argumentUnchanged: true, namespacesUnchanged: true, reached: false },
      ]),
    ),
  );
});
