import type stateAttached from "./state-attached.ts";

declare namespace stateAttachedTypes {
  type AttachedReplicatedStateImpl<T> = InstanceType<
    typeof stateAttached.AttachedReplicatedStateImpl<T>
  >;
}

export type { stateAttachedTypes as default };
