import type { Context, ReplicatedState } from "../../src/index.ts";

declare namespace replicatedStateDeliveryTypes {
  interface DeliveryFixture {
    readonly state: ReplicatedState<Value>;
    readonly publish: (value: Value, context: Context) => void;
  }

  type Value = { value: number };

  type Kind = "mutable" | "attached";
}

export type { replicatedStateDeliveryTypes as default };
