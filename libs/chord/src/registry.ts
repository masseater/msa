import { dual } from "effect/Function";

import type registryTypes from "./registry.types.ts";

const registryOf = <V>(
  name: string,
  options: { conflict?: "error" | "last" } = {},
): registryTypes.Registry<V> => ({
  conflict: options.conflict ?? "error",
  name,
});

const defineRegistry: {
  (options?: { conflict?: "error" | "last" }): <V>(name: string) => registryTypes.Registry<V>;
  <V>(name: string, options?: { conflict?: "error" | "last" }): registryTypes.Registry<V>;
} = dual((args) => args.length >= 1, registryOf);

const registryModule = {
  defineRegistry,
};

export default registryModule;
