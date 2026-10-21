import { ConfigProvider, Effect, Predicate } from "effect";
import { dual } from "effect/Function";

import type platformTypes from "./index.types.ts";

let overrides: Readonly<Record<string, string>> = {};

const liveProvider = (): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromEnv({ preserveEmptyStrings: true });

const readEnv = (name: string): string | undefined => {
  const override = overrides[name];
  if (override !== undefined) return override;
  const node = Effect.runSync(liveProvider().load([name]));
  return node === undefined ? undefined : node.value;
};

const writeEnv: {
  (value: string): (name: string) => void;
  (name: string, value: string): void;
} = dual(2, (name: string, value: string): void => {
  overrides = { ...overrides, [name]: value };
});

const deleteEnv = (name: string): void => {
  const { [name]: _removed, ...rest } = overrides;
  overrides = rest;
};

const collectNode = (
  provider: ConfigProvider.ConfigProvider,
  node: ConfigProvider.Node,
  path: ReadonlyArray<string>,
  into: Record<string, string>,
): void => {
  if (path.length > 0 && node.value !== undefined) into[path.join("_")] = node.value;
  if (Predicate.isTagged(node, "Value")) return;
  const children = Predicate.isTagged(node, "Record")
    ? [...node.keys]
    : Array.from({ length: node.length }, (_, index) => String(index));
  for (const child of children) {
    const childNode = Effect.runSync(provider.load([...path, child]));
    if (childNode !== undefined) collectNode(provider, childNode, [...path, child], into);
  }
};

const liveSnapshot = (): Record<string, string> => {
  const provider = liveProvider();
  const root = Effect.runSync(provider.load([]));
  const into: Record<string, string> = {};
  if (root !== undefined) collectNode(provider, root, [], into);
  return into;
};

const envSnapshot = (): Record<string, string> => ({ ...liveSnapshot(), ...overrides });

const envNames = (): ReadonlyArray<string> => Object.keys(envSnapshot());

const applyValues = (values: platformTypes.EnvValues): void => {
  const next: Record<string, string> = { ...overrides };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete next[name];
    else next[name] = value;
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
  deleteEnv,
  envNames,
  envSnapshot,
  readEnv,
  withEnv,
  writeEnv,
};

export default platformEnv;
