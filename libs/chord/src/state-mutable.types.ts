import type MutableReplicatedStateImplClass from "./state-mutable.ts";

declare namespace stateMutableTypes {
  type MutableReplicatedStateImpl<T extends object> = MutableReplicatedStateImplClass<T>;
}

export type { stateMutableTypes as default };
