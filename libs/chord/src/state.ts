import { dual } from "effect/Function";

import { attachReplicatedStateSource } from "./state-attached.ts";
import { MutableReplicatedStateImpl } from "./state-mutable.ts";
import type {
  AttachedReplicatedState,
  MutableReplicatedState,
  ReplicatedStateSource,
  ReplicatedStateSourceOptions,
} from "./state-types.ts";

export type {
  AttachedReplicatedState,
  MutableReplicatedState,
  ReplicatedState,
  ReplicatedStateDelivery,
  ReplicatedStateSource,
  ReplicatedStateSourceAttachment,
  ReplicatedStateSourceFrame,
  ReplicatedStateSourceOptions,
} from "./state-types.ts";

function stateReplicated(
  initialOrSource: object | ReplicatedStateSource<unknown>,
  options?: ReplicatedStateSourceOptions,
): MutableReplicatedState<object> | AttachedReplicatedState<unknown> {
  if (isReplicatedStateSource(initialOrSource))
    return attachReplicatedStateSource(initialOrSource, options ?? {});
  return new MutableReplicatedStateImpl(initialOrSource);
}

function isReplicatedStateSource(value: object): value is ReplicatedStateSource<unknown> {
  return typeof (value as { readonly attach?: unknown }).attach === "function";
}

export const replicatedState: {
  <T>(
    source: ReplicatedStateSource<T>,
    options?: ReplicatedStateSourceOptions,
  ): AttachedReplicatedState<T>;
  <T extends object>(initial: T): MutableReplicatedState<T>;
  (
    options?: ReplicatedStateSourceOptions,
  ): <T>(source: ReplicatedStateSource<T>) => AttachedReplicatedState<T>;
} = dual((args) => args.length >= 1, stateReplicated);
