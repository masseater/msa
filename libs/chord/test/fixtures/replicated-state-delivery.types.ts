import type chordTypes from "../../src/index.types.ts";

declare namespace replicatedStateDeliveryTypes {
  interface DeliveryFixture {
    readonly state: chordTypes.ReplicatedState<Value>;
    readonly publish: (value: Value, context: chordTypes.Context) => void;
  }

  type Value = { value: number };

  type Kind = "mutable" | "attached";
}

export type { replicatedStateDeliveryTypes as default };
