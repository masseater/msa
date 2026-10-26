import { ConfigProvider, Effect, Predicate } from "effect";
import { dual } from "effect/Function";

import type platformTypes from "./index.types.ts";

let overrides: ReadonlyMap<string, string> = new Map();

const liveProvider = (): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromEnv({ preserveEmptyStrings: true });

const liveValues = (): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromEnv({
    env: process.env as Record<string, string>,
    preserveEmptyStrings: true,
  });

const readEnv = (name: string): string | undefined => {
  const override = overrides.get(name);
  if (override !== undefined) return override;
  const node = Effect.runSync(liveValues().load([name]));
  return node === undefined ? undefined : node.value;
};

const writeEnv: {
  (value: string): (name: string) => void;
  (name: string, value: string): void;
} = dual(2, (name: string, value: string): void => {
  overrides = new Map(overrides).set(name, value);
});

const deleteEnv = (name: string): void => {
  const rest = new Map(overrides);
  rest.delete(name);
  overrides = rest;
};

const assignProcessEnv = (values: Readonly<Record<string, string>>): void => {
  for (const name of Object.keys(values)) process.env[name] = String(values[name]);
};

const collectNode = (
  provider: ConfigProvider.ConfigProvider,
  node: ConfigProvider.Node,
  path: ReadonlyArray<string>,
  into: Map<string, string>,
): void => {
  if (path.length > 0 && node.value !== undefined) into.set(path.join("_"), node.value);
  if (Predicate.isTagged(node, "Value")) return;
  const children = Predicate.isTagged(node, "Record")
    ? [...node.keys]
    : Array.from({ length: node.length }, (_, index) => String(index));
  for (const child of children) {
    const childNode = Effect.runSync(provider.load([...path, child]));
    if (childNode !== undefined) collectNode(provider, childNode, [...path, child], into);
  }
};

const liveSnapshot = (): Map<string, string> => {
  const provider = liveProvider();
  const root = Effect.runSync(provider.load([]));
  const into = new Map<string, string>();
  if (root !== undefined) collectNode(provider, root, [], into);
  return into;
};

const envSnapshot = (): Record<string, string> =>
  Object.fromEntries([...liveSnapshot(), ...overrides]);

const envNames = (): ReadonlyArray<string> => Object.keys(envSnapshot());

const applyValues = (values: platformTypes.EnvValues): void => {
  const next = new Map(overrides);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) next.delete(name);
    else next.set(name, value);
  }
  overrides = next;
};

const withEnv =
  (values: platformTypes.EnvValues) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = overrides;
        applyValues(values);
        return previous;
      }),
      () => effect,
      (previous) =>
        Effect.sync(() => {
          overrides = previous;
        }),
    );

const platformEnv = {
  assignProcessEnv,
  deleteEnv,
  envNames,
  envSnapshot,
  readEnv,
  withEnv,
  writeEnv,
};

export default platformEnv;
