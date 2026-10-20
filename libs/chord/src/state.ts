import { dual } from "effect/Function";

import stateAttached from "./state-attached.ts";
import MutableReplicatedStateImpl from "./state-mutable.ts";
import type stateTypesModule from "./state-types.ts";

const { attachReplicatedStateSource } = stateAttached;

function stateReplicated(
  initialOrSource: object | stateTypesModule.ReplicatedStateSource<unknown>,
  options?: stateTypesModule.ReplicatedStateSourceOptions,
):
  | stateTypesModule.MutableReplicatedState<object>
  | stateTypesModule.AttachedReplicatedState<unknown> {
  if (isReplicatedStateSource(initialOrSource))
    return attachReplicatedStateSource(initialOrSource, options ?? {});
  return new MutableReplicatedStateImpl(initialOrSource);
}

function isReplicatedStateSource(
  value: object,
): value is stateTypesModule.ReplicatedStateSource<unknown> {
  return typeof (value as { readonly attach?: unknown }).attach === "function";
}

const replicatedState: {
  <T>(
    source: stateTypesModule.ReplicatedStateSource<T>,
    options?: stateTypesModule.ReplicatedStateSourceOptions,
  ): stateTypesModule.AttachedReplicatedState<T>;
  <T extends object>(initial: T): stateTypesModule.MutableReplicatedState<T>;
  (
    options?: stateTypesModule.ReplicatedStateSourceOptions,
  ): <T>(
    source: stateTypesModule.ReplicatedStateSource<T>,
  ) => stateTypesModule.AttachedReplicatedState<T>;
} = dual((args) => args.length >= 1, stateReplicated);

const state = {
  replicatedState,
};

export default state;
