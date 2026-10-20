import type stateTypesModule from "./state-types.ts";

declare namespace stateTypes {
  type AttachedReplicatedState<T> = stateTypesModule.AttachedReplicatedState<T>;

  type MutableReplicatedState<T extends object> = stateTypesModule.MutableReplicatedState<T>;

  type ReplicatedState<T> = stateTypesModule.ReplicatedState<T>;

  type ReplicatedStateDelivery = stateTypesModule.ReplicatedStateDelivery;

  type ReplicatedStateSource<T> = stateTypesModule.ReplicatedStateSource<T>;

  type ReplicatedStateSourceAttachment<T> = stateTypesModule.ReplicatedStateSourceAttachment<T>;

  type ReplicatedStateSourceFrame<T> = stateTypesModule.ReplicatedStateSourceFrame<T>;

  type ReplicatedStateSourceOptions = stateTypesModule.ReplicatedStateSourceOptions;
}

export type { stateTypes as default };
